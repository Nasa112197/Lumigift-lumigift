/**
 * GET /api/v1/exchange-rate/quote
 *
 * Returns a real-time NGN → USDC conversion quote using the existing
 * exchange rate service.  The quote is valid for 60 seconds.
 *
 * Query params:
 *   amountNgn — Amount in Nigerian Naira (required, positive number)
 *
 * Response:
 *   amountNgn    — The input amount in NGN
 *   amountUsdc   — Equivalent amount in USDC (4 decimal places)
 *   ngnPerUsdc   — Exchange rate used
 *   fetchedAt    — ISO 8601 timestamp when the rate was fetched
 *   expiresAt    — ISO 8601 timestamp 60 seconds after fetchedAt
 *   provider     — Rate source ('cache' | 'horizon' | 'fallback-provider' | 'fallback')
 *
 * Issue #151 — Multi-currency pricing display.
 */
import { NextRequest, NextResponse } from "next/server";
import { withAuth, withErrorHandler, AppError, ERROR_CODES } from "@/server/middleware";
import { getExchangeRate } from "@/server/services/exchange-rate.service";
import type { ApiResponse } from "@/types";

/** Quote response shape. */
export interface ExchangeRateQuote {
  amountNgn: number;
  amountUsdc: number;
  ngnPerUsdc: number;
  fetchedAt: string;
  expiresAt: string;
  provider: string;
}

/** Quote validity window in seconds. */
const QUOTE_TTL_SEC = 60;

export const GET = withErrorHandler(
  withAuth(async (req: NextRequest) => {
    const { searchParams } = req.nextUrl;

    const rawAmount = searchParams.get("amountNgn");
    if (!rawAmount) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "amountNgn is required", 400);
    }

    const amountNgn = parseFloat(rawAmount);
    if (!isFinite(amountNgn) || amountNgn <= 0) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, "amountNgn must be a positive number", 400);
    }

    const rateResult = await getExchangeRate();

    const fetchedAt = new Date();
    const expiresAt = new Date(fetchedAt.getTime() + QUOTE_TTL_SEC * 1000);

    // Convert NGN → USDC and round to 4 decimal places
    const amountUsdc = parseFloat((amountNgn / rateResult.ngnPerUsdc).toFixed(4));

    const quote: ExchangeRateQuote = {
      amountNgn,
      amountUsdc,
      ngnPerUsdc: rateResult.ngnPerUsdc,
      fetchedAt: fetchedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      provider: rateResult.source,
    };

    return NextResponse.json<ApiResponse<ExchangeRateQuote>>({ success: true, data: quote });
  })
);
