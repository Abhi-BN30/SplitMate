
import { sql } from '@/lib/db';
import {
  requireUser,
  json,
  errorResponse,
  isMember
} from '@/lib/http';

type Member = {
  id: string;
  full_name: string;
};

type Balance = {
  id: string;
  full_name: string;
  paidPaise: number;
  sharePaise: number;
  netPaise: number;
};

type SettlementCandidate = Balance & {
  remaining: number;
};

export async function GET(req: Request) {
  try {
    const u = await requireUser();
    const groupId = new URL(req.url).searchParams.get('groupId');

    if (!groupId || !await isMember(groupId, u.id)) {
      return json(
        { error: 'Choose a group you belong to.' },
        403
      );
    }

    const members = await sql<Member[]>`
      SELECT
        u.id,
        u.full_name
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ${groupId}
    `;

    const owed = await sql`
      SELECT
        s.user_id,
        SUM(s.amount_paise)::bigint AS amount
      FROM expense_item_shares s
      JOIN expense_items i ON i.id = s.item_id
      JOIN expenses e ON e.id = i.expense_id
      WHERE e.group_id = ${groupId}
        AND e.status = 'active'
      GROUP BY s.user_id
    `;

    const paid = await sql`
      SELECT
        p.user_id,
        SUM(p.amount_paise)::bigint AS amount
      FROM expense_payers p
      JOIN expenses e ON e.id = p.expense_id
      WHERE e.group_id = ${groupId}
        AND e.status = 'active'
      GROUP BY p.user_id
    `;

    const settlements = await sql`
      SELECT
        payer_id,
        receiver_id,
        SUM(amount_paise)::bigint AS amount
      FROM settlements
      WHERE group_id = ${groupId}
        AND status = 'confirmed'
      GROUP BY payer_id, receiver_id
    `;

    // Calculate each member's net group balance.
    const balances: Balance[] = members.map(m => {
      const expensesPaid = Number(
        paid.find(x => x.user_id === m.id)?.amount || 0
      );

      const share = Number(
        owed.find(x => x.user_id === m.id)?.amount || 0
      );

      const sent = settlements
        .filter(x => x.payer_id === m.id)
        .reduce((sum, x) => sum + Number(x.amount), 0);

      const received = settlements
        .filter(x => x.receiver_id === m.id)
        .reduce((sum, x) => sum + Number(x.amount), 0);

      return {
        id: m.id,
        full_name: m.full_name,
        paidPaise: expensesPaid,
        sharePaise: share,
        netPaise: expensesPaid - share + sent - received
      };
    });

    // Members with positive balances are creditors.
    const creditors: SettlementCandidate[] = balances
      .filter(x => x.netPaise > 0)
      .map(x => ({
        ...x,
        remaining: x.netPaise
      }));

    // Members with negative balances are debtors.
    const debtors: SettlementCandidate[] = balances
      .filter(x => x.netPaise < 0)
      .map(x => ({
        ...x,
        remaining: -x.netPaise
      }));

    // Generate simplified settlement suggestions.
    const suggestions: {
      payerId: string;
      payerName: string;
      receiverId: string;
      receiverName: string;
      amountPaise: number;
    }[] = [];

    let i = 0;
    let j = 0;

    creditors.sort((a, b) => b.remaining - a.remaining);
    debtors.sort((a, b) => b.remaining - a.remaining);

    while (i < debtors.length && j < creditors.length) {
      const amount = Math.min(
        debtors[i].remaining,
        creditors[j].remaining
      );

      if (amount > 0) {
        suggestions.push({
          payerId: debtors[i].id,
          payerName: debtors[i].full_name,
          receiverId: creditors[j].id,
          receiverName: creditors[j].full_name,
          amountPaise: amount
        });
      }

      debtors[i].remaining -= amount;
      creditors[j].remaining -= amount;

      if (debtors[i].remaining === 0) {
        i++;
      }

      if (creditors[j].remaining === 0) {
        j++;
      }
    }

    return json({
      balances,
      suggestions
    });

  } catch (e) {
    return errorResponse(e);
  }
}
