
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
  const message =
    e instanceof Error ? e.message : 'Unexpected error';

  return json(
    { error: message },
    message === 'UNAUTHORIZED' ? 401 : 400
  );
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
