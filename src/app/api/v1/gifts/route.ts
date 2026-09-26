import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createGiftSchema } from "@/types/schemas";
import {
  createGift,
  getGiftsBySenderPaginated,
  getGiftsBySenderPage,
} from "@/server/services/gift.service";
import { withErrorHandler, withCsrf } from "@/server/middleware";
import {
  checkIdempotencyKey,
  storeIdempotencyResponse,
  IDEMPOTENCY_KEY_HEADER,
} from "@/server/idempotency";
import type { ApiResponse, Gift } from "@/types";
import type { GiftPage, GiftPageOffset } from "@/server/services/gift.service";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

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

  // Offset-based pagination (page + limit)
  if (searchParams.has("page") || searchParams.has("limit")) {
    const page = Math.max(
      1,
      parseInt(searchParams.get("page") ?? String(DEFAULT_PAGE), 10) || DEFAULT_PAGE
    );
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
    );
    const result = await getGiftsBySenderPage(userId, page, limit);
    return NextResponse.json<ApiResponse<GiftPageOffset>>({ success: true, data: result });
  }

  // Cursor-based pagination (legacy)
  const cursor = searchParams.get("cursor");
  const pageSize = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "10", 10) || 10)
  );
  const page = await getGiftsBySenderPaginated(userId, cursor, pageSize);
  return NextResponse.json<ApiResponse<GiftPage>>({ success: true, data: page });
});

export const POST = withErrorHandler(
  withCsrf(async (req: NextRequest) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = createGiftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const userId = (session.user as { id: string }).id;
    const idempotencyKey = req.headers.get(IDEMPOTENCY_KEY_HEADER);

    // ── Idempotency check ─────────────────────────────────────────────────────
    const idempotencyResult = await checkIdempotencyKey(idempotencyKey, userId, parsed.data);

    if (idempotencyResult.type === "invalid") {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: "Idempotency-Key must be a valid UUID v4",
          code: "VALIDATION_ERROR",
        },
        { status: 400 }
      );
    }

    if (idempotencyResult.type === "conflict") {
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: "Idempotency key already used with a different payload",
          code: "IDEMPOTENCY_CONFLICT",
        },
        { status: 409 }
      );
    }

    if (idempotencyResult.type === "replay") {
      // Return the original response — gift was already created
      return NextResponse.json(idempotencyResult.body, { status: idempotencyResult.status });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { gift, paymentUrl } = await createGift(
      userId,
      parsed.data,
      parsed.data.recipientIsRegistered
    );

    const responseBody: ApiResponse<{ gift: Gift; paymentUrl: string }> = {
      success: true,
      data: { gift, paymentUrl },
    };

    // Store the response only when an idempotency key was provided
    if (idempotencyResult.type === "new") {
      await storeIdempotencyResponse(
        idempotencyResult.redisKey,
        idempotencyResult.payloadHash,
        201,
        responseBody
      );
    }

    return NextResponse.json(responseBody, { status: 201 });
  })
);
