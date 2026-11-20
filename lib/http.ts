
import { NextResponse } from 'next/server';
import { currentUser } from './auth';

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });

export async function requireUser() {
  const user = await currentUser();

  if (!user) {
    throw new Error('UNAUTHORIZED');
  }

  return user;
}

export function errorResponse(e: unknown) {
  if (e instanceof Error && e.message === 'UNAUTHORIZED') {
    return json({ error: 'Authentication required.' }, 401);
  }
  if (e instanceof SyntaxError) {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }
  console.error('API request failed:', e);
  return json({ error: 'An unexpected server error occurred.' }, 500);
}

export async function isMember(
  groupId: string,
  userId: string
) {
  const { sql } = await import('./db');

  const r = await sql`
    SELECT role
    FROM group_members
    WHERE group_id = ${groupId}
      AND user_id = ${userId}
  `;

  return r[0] || null;
}

export async function logActivity(
  groupId: string,
  actorId: string,
  action: string,
  entityType?: string,
  entityId?: string,
  details: Record<string, unknown> = {}
) {
  const { sql } = await import('./db');

  // Convert the details object into JSON-compatible data.
  const jsonDetails = JSON.parse(
    JSON.stringify(details)
  );

  await sql`
    INSERT INTO activity_logs (
      group_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      details
    )
    VALUES (
      ${groupId},
      ${actorId},
      ${action},
      ${entityType || null},
      ${entityId || null},
      ${sql.json(jsonDetails)}
    )
  `;
}
