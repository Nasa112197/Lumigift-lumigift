/**
 * Transaction history service — issue #150
 *
 * Provides paginated transaction history and structured receipt data for gifts.
 * Queries the PostgreSQL database via the existing pool from @/lib/db.
 */
import pool from "@/lib/db";
import { AppError, ERROR_CODES } from "@/server/errors";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransactionRecord {
  giftId: string;
  amount: number;
  provider: string;
  stellarTxHash: string | null;
  status: string;
  createdAt: Date;
}

export interface TransactionPage {
  items: TransactionRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TransactionFilters {
  page?: number;
  limit?: number;
  status?: string;
}

export interface ReceiptData {
  giftId: string;
  amountNgn: number;
  amountUsdc: string;
  provider: string;
  providerReference: string;
  stellarTxHash: string | null;
  status: string;
  senderName: string;
  recipientName: string;
  createdAt: Date;
  completedAt: Date | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Returns a paginated list of transactions (gifts sent + payments) for a user.
 *
 * @param userId  - UUID of the authenticated sender.
 * @param filters - Optional pagination and status filters.
 * @returns A {@link TransactionPage} with items and pagination metadata.
 */
export async function getTransactionHistory(
  userId: string,
  filters: TransactionFilters = {}
): Promise<TransactionPage> {
  const page = Math.max(1, filters.page ?? DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
  const offset = (page - 1) * limit;

  const params: (string | number)[] = [userId];
  let statusClause = "";

  if (filters.status) {
    params.push(filters.status);
    statusClause = `AND g.status = $${params.length}`;
  }

  const dataQuery = `
    SELECT
      g.id           AS "giftId",
      p.amount_ngn   AS amount,
      p.provider,
      g.stellar_tx_hash AS "stellarTxHash",
      g.status,
      g.created_at   AS "createdAt"
    FROM gifts g
    LEFT JOIN payments p ON p.gift_id = g.id
    WHERE g.sender_id = $1
    ${statusClause}
    ORDER BY g.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM gifts g
    WHERE g.sender_id = $1
    ${statusClause}
  `;

  const [dataResult, countResult] = await Promise.all([
    pool.query<{
      giftId: string;
      amount: number;
      provider: string;
      stellarTxHash: string | null;
      status: string;
      createdAt: Date;
    }>(dataQuery, params),
    pool.query<{ total: string }>(countQuery, params),
  ]);

  const total = parseInt(countResult.rows[0]?.total ?? "0", 10);

  const items: TransactionRecord[] = dataResult.rows.map((row) => ({
    giftId: row.giftId,
    amount: row.amount ?? 0,
    provider: row.provider ?? "unknown",
    stellarTxHash: row.stellarTxHash ?? null,
    status: row.status,
    createdAt: row.createdAt,
  }));

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Generates structured receipt data for a specific gift.
 *
 * Only the gift sender may request a receipt.  Throws a FORBIDDEN {@link AppError}
 * if `userId` does not match the gift's `sender_id`.
 *
 * @param giftId - UUID of the gift.
 * @param userId - UUID of the requesting user (must be the sender).
 * @returns A {@link ReceiptData} object with all billing and chain details.
 * @throws {AppError} FORBIDDEN if the caller is not the sender.
 * @throws {AppError} NOT_FOUND if the gift does not exist.
 */
export async function generateReceiptData(giftId: string, userId: string): Promise<ReceiptData> {
  const result = await pool.query<{
    giftId: string;
    amountNgn: number;
    amountUsdc: string;
    provider: string;
    providerReference: string;
    stellarTxHash: string | null;
    status: string;
    senderName: string;
    recipientName: string;
    createdAt: Date;
    completedAt: Date | null;
    senderId: string;
  }>(
    `SELECT
       g.id                       AS "giftId",
       g.amount_ngn               AS "amountNgn",
       g.amount_usdc              AS "amountUsdc",
       COALESCE(p.provider, '')   AS provider,
       COALESCE(p.provider_reference, '') AS "providerReference",
       g.stellar_tx_hash          AS "stellarTxHash",
       g.status,
       COALESCE(su.display_name, '') AS "senderName",
       g.recipient_name           AS "recipientName",
       g.created_at               AS "createdAt",
       g.updated_at               AS "completedAt",
       g.sender_id                AS "senderId"
     FROM gifts g
     LEFT JOIN payments p ON p.gift_id = g.id
     LEFT JOIN users su ON su.id = g.sender_id
     WHERE g.id = $1
     LIMIT 1`,
    [giftId]
  );

  const row = result.rows[0];

  if (!row) {
    throw new AppError(ERROR_CODES.GIFT_NOT_FOUND, "Gift not found", 404);
  }

  if (row.senderId !== userId) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "Forbidden", 403);
  }

  // Only show completedAt when the gift reached a terminal state
  const terminalStatuses = new Set(["claimed", "expired", "cancelled"]);
  const completedAt = terminalStatuses.has(row.status) ? row.completedAt : null;

  return {
    giftId: row.giftId,
    amountNgn: row.amountNgn,
    amountUsdc: row.amountUsdc,
    provider: row.provider,
    providerReference: row.providerReference,
    stellarTxHash: row.stellarTxHash,
    status: row.status,
    senderName: row.senderName,
    recipientName: row.recipientName,
    createdAt: row.createdAt,
    completedAt,
  };
}
