/**
 * GET /api/v1/transactions
 *
 * Returns a paginated transaction history (gifts sent + associated payments)
 * for the authenticated user.
 *
 * Query params:
 *   page   — 1-based page number (default: 1)
 *   limit  — items per page (default: 10, max: 100)
 *   status — optional filter by gift status
 *
 * Issue #150 — Transaction history & downloadable receipts.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withAuth, withErrorHandler } from "@/server/middleware";
import {
  getTransactionHistory,
  type TransactionPage,
} from "@/server/services/transaction-history.service";
import type { ApiResponse } from "@/types";

export const GET = withErrorHandler(
  withAuth(async (req: NextRequest) => {
    const session = await getServerSession(authOptions);
    const userId = (session!.user as { id: string }).id;

    const { searchParams } = req.nextUrl;

    const page = parseInt(searchParams.get("page") ?? "1", 10) || 1;
    const limit = parseInt(searchParams.get("limit") ?? "10", 10) || 10;
    const status = searchParams.get("status") ?? undefined;

    const result = await getTransactionHistory(userId, { page, limit, status });

    return NextResponse.json<ApiResponse<TransactionPage>>({ success: true, data: result });
  })
);
