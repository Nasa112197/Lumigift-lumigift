import { NextRequest, NextResponse } from "next/server";
import { queryAuditLogs, AuditEventType } from "@/server/services/audit.service";
import { withErrorHandler } from "@/server/middleware";
import { requireAdmin } from "@/server/middleware/admin";
import type { ApiResponse } from "@/types";

interface AuditLogQueryResponse {
  logs: Array<{
    id: string;
    eventType: AuditEventType;
    userId: string | null;
    giftId: string | null;
    amountNgn: number | null;
    amountUsdc: string | null;
    timestamp: Date;
    ipAddress: string | null;
    userAgent: string | null;
    metadata: Record<string, unknown> | null;
  }>;
  total: number;
}

export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const searchParams = req.nextUrl.searchParams;
  const userId = searchParams.get("userId") ?? undefined;
  const giftId = searchParams.get("giftId") ?? undefined;
  const eventType = searchParams.get("eventType") as AuditEventType | null;
  const startDateStr = searchParams.get("startDate");
  const endDateStr = searchParams.get("endDate");
  const limitStr = searchParams.get("limit");
  const offsetStr = searchParams.get("offset");

  const startDate = startDateStr ? new Date(startDateStr) : undefined;
  const endDate = endDateStr ? new Date(endDateStr) : undefined;
  const limit = limitStr ? parseInt(limitStr, 10) : 50;
  const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

export const GET = withErrorHandler(async (req: NextRequest) => {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const parsed = parseAuditLogQuery(req.nextUrl.searchParams);
  if ("error" in parsed) return invalidQuery(parsed.error);

  const result = await queryAuditLogs(parsed.query);

  return NextResponse.json<ApiResponse<AuditLogQueryResponse>>({
    success: true,
    data: result,
  });
});
