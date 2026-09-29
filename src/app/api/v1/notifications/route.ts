/**
 * GET  /api/v1/notifications — returns paginated notifications for the authenticated user
 * PATCH /api/v1/notifications — marks notification(s) as read
 *
 * Issue #153 — User notification center
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import pool from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { withErrorHandler } from "@/server/middleware";
import type { ApiResponse } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  message: string;
  read_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  total: number;
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const patchSchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1) }),
  z.object({ all: z.literal(true) }),
]);

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ─── GET ──────────────────────────────────────────────────────────────────────

export const GET = withErrorHandler(async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const userId = (session.user as { id: string }).id;
  const { searchParams } = req.nextUrl;

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);

  const [notificationsResult, unreadResult, totalResult] = await Promise.all([
    pool.query<Notification>(
      `SELECT id, user_id, type, message, read_at, created_at, metadata
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1`,
      [userId]
    ),
  ]);

  const unreadCount = parseInt(unreadResult.rows[0]?.count ?? "0", 10);
  const total = parseInt(totalResult.rows[0]?.count ?? "0", 10);

  return NextResponse.json<ApiResponse<NotificationsResponse>>({
    success: true,
    data: {
      notifications: notificationsResult.rows,
      unreadCount,
      total,
    },
  });
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

export const PATCH = withErrorHandler(async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const userId = (session.user as { id: string }).id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  if ("all" in parsed.data) {
    // Mark all unread notifications as read for this user
    await pool.query(
      `UPDATE notifications SET read_at = $1 WHERE user_id = $2 AND read_at IS NULL`,
      [now, userId]
    );
  } else {
    // Mark specific notifications as read — only update rows owned by this user
    await pool.query(
      `UPDATE notifications SET read_at = $1
       WHERE user_id = $2 AND id = ANY($3::uuid[]) AND read_at IS NULL`,
      [now, userId, parsed.data.ids]
    );
  }

  // Return updated unread count
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  const unreadCount = parseInt(rows[0]?.count ?? "0", 10);

  return NextResponse.json<ApiResponse<{ unreadCount: number }>>({
    success: true,
    data: { unreadCount },
  });
});
