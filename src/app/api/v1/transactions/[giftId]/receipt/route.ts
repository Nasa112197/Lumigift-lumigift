/**
 * GET /api/v1/transactions/[giftId]/receipt
 *
 * Returns structured receipt JSON for a specific gift.
 * Only the gift sender may download the receipt.
 *
 * Response includes:
 *   giftId, amountNgn, amountUsdc, provider, providerReference,
 *   stellarTxHash, status, senderName, recipientName, createdAt, completedAt
 *
 * Issue #150 — Transaction history & downloadable receipts.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withAuth, withErrorHandler } from "@/server/middleware";
import {
  generateReceiptData,
  type ReceiptData,
} from "@/server/services/transaction-history.service";
import type { ApiResponse } from "@/types";

export const GET = withErrorHandler(
  withAuth(async (_req: NextRequest, context: unknown) => {
    const session = await getServerSession(authOptions);
    const userId = (session!.user as { id: string }).id;

    const { params } = context as { params: { giftId: string } };
    const { giftId } = params;

    // generateReceiptData throws AppError FORBIDDEN if userId !== sender
    const receipt = await generateReceiptData(giftId, userId);

    return NextResponse.json<ApiResponse<ReceiptData>>({ success: true, data: receipt });
  })
);
