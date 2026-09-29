import { NextRequest, NextResponse } from "next/server";
import { queryAuditLogs, AuditEventType } from "@/server/services/audit.service";
import { withErrorHandler } from "@/server/middleware";
import { requireAdmin } from "@/server/middleware/admin";
import { parseAuditLogQuery } from "./query";
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

function invalidQuery(error: string): NextResponse {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error, code: "VALIDATION_ERROR" },
    { status: 400 }
  );
}

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
