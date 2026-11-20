import { sql } from '@/lib/db';
import { requireUser, json, errorResponse, isMember } from '@/lib/http';

export const runtime = 'nodejs';
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'Choose a bill image or PDF.' }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return json({ error: 'Receipt uploads must be smaller than 4 MB.' }, 413);
    if (!allowedTypes.has(file.type)) return json({ error: 'Supported formats: JPG, PNG, WEBP and PDF.' }, 400);
    const groupId = String(form.get('groupId') || '');
    if (!groupId || !await isMember(groupId, user.id)) return json({ error: 'Choose a group you belong to.' }, 403);
    const bytes = Buffer.from(await file.arrayBuffer());
    const validSignature = file.type === 'application/pdf'
      ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
      : file.type === 'image/jpeg'
        ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : file.type === 'image/png'
          ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!validSignature) return json({ error: 'The file contents do not match the selected format.' }, 400);

    const [receipt] = await sql`
      INSERT INTO receipt_uploads(group_id, uploaded_by, content_type, file_data)
      VALUES(${groupId}, ${user.id}, ${file.type}, ${bytes})
      RETURNING id
    `;
    return json({ receiptUrl: `/api/expenses/scan?id=${receipt.id}` });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return json({ error: 'Receipt not found.' }, 404);
    const [receipt] = await sql`
      SELECT r.group_id, r.content_type, r.file_data
      FROM receipt_uploads r
      JOIN expenses e ON e.id = r.expense_id
      WHERE r.id = ${id} AND e.status = 'active'
    `;
    if (!receipt || !await isMember(receipt.group_id, user.id)) return json({ error: 'Receipt not found.' }, 404);

    return new Response(new Uint8Array(receipt.file_data), {
      headers: {
        'Content-Type': receipt.content_type,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (e) {
    return errorResponse(e);
  }
}
