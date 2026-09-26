/**
 * Typed Soroban contract event shapes for the Lumigift escrow contract.
 *
 * ## Event schema (v1)
 *
 * The escrow contract emits four events. All payloads are encoded as a
 * `ScVec` in the `data` field of the Soroban `ContractEvent`.
 * Topics are `Symbol` values used for filtering.
 *
 * ### `initialized`
 * Emitted by `initialize()` — escrow created and funded.
 *
 * ```
 * topics: ["initialized"]
 * data:   ScVec [sender: ScAddress, recipient: ScAddress, amount: I128, unlock_time: U64]
 * ```
 *
 * | Index | Soroban type | Description                          |
 * |-------|--------------|--------------------------------------|
 * | 0     | ScAddress    | sender — address that created gift   |
 * | 1     | ScAddress    | recipient — address to claim funds   |
 * | 2     | I128         | amount in USDC stroops               |
 * | 3     | U64          | unlock_time Unix timestamp (seconds) |
 *
 * ### `claimed`
 * Emitted by `claim()` — recipient successfully claimed funds (terminal).
 *
 * ```
 * topics: ["claimed"]
 * data:   ScVec [recipient: ScAddress, amount: I128]
 * ```
 *
 * | Index | Soroban type | Description                             |
 * |-------|--------------|---------------------------------------------|
 * | 0     | ScAddress    | recipient — address that received funds |
 * | 1     | I128         | amount transferred in USDC stroops      |
 *
 * ### `cancelled`
 * Emitted by `cancel()` — sender cancelled, funds returned (terminal).
 *
 * ```
 * topics: ["cancelled"]
 * data:   ScVec [sender: ScAddress, amount: I128]
 * ```
 *
 * | Index | Soroban type | Description                             |
 * |-------|--------------|---------------------------------------------|
 * | 0     | ScAddress    | sender — address that received refund   |
 * | 1     | I128         | amount refunded in USDC stroops         |
 *
 * ### `upgraded` (admin-only, not decoded here)
 * Emitted by `upgrade()`.
 *
 * ```
 * topics: ["upgraded"]
 * data:   ScVec [old_contract: ScAddress, new_wasm_hash: Bytes(32)]
 * ```
 *
 * ## Versioning
 *
 * Schema version: **v1**. Breaking changes require a new topic name (e.g.
 * `initialized_v2`). Additive changes that append optional fields must update
 * this JSDoc and `docs/contract-events.md`.
 *
 * ## Full documentation
 *
 * See `docs/contract-events.md` for payload tables, example fixtures,
 * and indexer integration guidance.
 */

import { rpc as SorobanRpc, Address, scValToNative, xdr } from "@stellar/stellar-sdk";

// ─── Event type discriminants ─────────────────────────────────────────────────

export type EscrowEventType = "initialized" | "claimed" | "cancelled";

// ─── Typed event payloads ─────────────────────────────────────────────────────

export interface InitializedEvent {
  type: "initialized";
  contractId: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  sender: string;
  recipient: string;
  amount: bigint;
  unlockTime: bigint;
}

export interface ClaimedEvent {
  type: "claimed";
  contractId: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  recipient: string;
  amount: bigint;
}

export interface CancelledEvent {
  type: "cancelled";
  contractId: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  sender: string;
  amount: bigint;
}

export type EscrowEvent = InitializedEvent | ClaimedEvent | CancelledEvent;

// ─── Cursor helpers ───────────────────────────────────────────────────────────

/** Sentinel cursor meaning "start from the beginning of the ledger history". */
export const CURSOR_GENESIS = "0000000000000000-0000000000";

// ─── Fetcher ──────────────────────────────────────────────────────────────────

export interface FetchEventsOptions {
  rpcUrl: string;
  contractId: string;
  /** Exclusive start cursor — fetch events *after* this cursor. */
  startCursor: string;
  /** Maximum number of events to return per call (Soroban RPC max is 10 000). */
  limit?: number;
}

export interface FetchEventsResult {
  events: EscrowEvent[];
  /** Cursor of the last event returned; pass as `startCursor` on the next call. */
  latestCursor: string;
}

/**
 * Fetches Soroban contract events for the escrow contract from the RPC node,
 * starting after `startCursor`.
 */
export async function fetchEscrowEvents(opts: FetchEventsOptions): Promise<FetchEventsResult> {
  const rpc = new SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });

  const isGenesis = opts.startCursor === CURSOR_GENESIS;

  // stellar-sdk v15: GetEventsRequest is either ledger-range or cursor mode
  const request: SorobanRpc.Api.GetEventsRequest = isGenesis
    ? {
        filters: [
          {
            type: "contract",
            contractIds: [opts.contractId],
            topics: [["*"]],
          },
        ],
        startLedger: 0,
        limit: opts.limit ?? 200,
      }
    : {
        filters: [
          {
            type: "contract",
            contractIds: [opts.contractId],
            topics: [["*"]],
          },
        ],
        cursor: opts.startCursor,
        limit: opts.limit ?? 200,
      };

  const response = await rpc.getEvents(request);

  const events: EscrowEvent[] = [];
  let latestCursor = opts.startCursor;

  for (const raw of response.events) {
    const parsed = parseEventResponse(raw);
    if (parsed) {
      events.push(parsed);
      // Use the event id as cursor (stellar-sdk v15 uses id for pagination)
      latestCursor = raw.id;
    }
  }

  // If the response has a cursor field, prefer it
  if (response.cursor && response.cursor !== opts.startCursor) {
    latestCursor = response.cursor;
  }

  return { events, latestCursor };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseEventResponse(raw: SorobanRpc.Api.EventResponse): EscrowEvent | null {
  // In stellar-sdk v15, EventResponse.topic is already xdr.ScVal[]
  // and EventResponse.value is already xdr.ScVal
  if (!raw.topic?.length) return null;

  const eventName = scValToNative(raw.topic[0]) as string;
  const dataVal = raw.value;

  // contractId is Contract | undefined in v15 — get the string address
  const contractId = raw.contractId?.toString() ?? "";

  const base = {
    contractId,
    ledger: raw.ledger,
    ledgerClosedAt: raw.ledgerClosedAt,
    txHash: raw.txHash,
  };

  try {
    if (eventName === "initialized") {
      return decodeInitializedEvent(base, dataVal);
    }
    if (eventName === "claimed") {
      return decodeClaimedEvent(base, dataVal);
    }
    if (eventName === "cancelled") {
      return decodeCancelledEvent(base, dataVal);
    }
  } catch (err) {
    console.warn("[escrow-events] failed to decode event", eventName, err);
  }

  return null;
}

function decodeInitializedEvent(
  base: Omit<InitializedEvent, "type" | "sender" | "recipient" | "amount" | "unlockTime">,
  data: xdr.ScVal
): InitializedEvent {
  const items = data.vec();
  if (!items || items.length !== 4) throw new Error("unexpected initialized data shape");
  const [senderVal, recipientVal, amountVal, unlockTimeVal] = items;
  return {
    ...base,
    type: "initialized",
    sender: Address.fromScVal(senderVal).toString(),
    recipient: Address.fromScVal(recipientVal).toString(),
    amount: BigInt(scValToNative(amountVal) as number | bigint),
    unlockTime: BigInt(scValToNative(unlockTimeVal) as number | bigint),
  };
}

function decodeClaimedEvent(
  base: Omit<ClaimedEvent, "type" | "recipient" | "amount">,
  data: xdr.ScVal
): ClaimedEvent {
  const items = data.vec();
  if (!items || items.length !== 2) throw new Error("unexpected claimed data shape");
  const [recipientVal, amountVal] = items;
  return {
    ...base,
    type: "claimed",
    recipient: Address.fromScVal(recipientVal).toString(),
    amount: BigInt(scValToNative(amountVal) as number | bigint),
  };
}

function decodeCancelledEvent(
  base: Omit<CancelledEvent, "type" | "sender" | "amount">,
  data: xdr.ScVal
): CancelledEvent {
  const items = data.vec();
  if (!items || items.length !== 2) throw new Error("unexpected cancelled data shape");
  const [senderVal, amountVal] = items;
  return {
    ...base,
    type: "cancelled",
    sender: Address.fromScVal(senderVal).toString(),
    amount: BigInt(scValToNative(amountVal) as number | bigint),
  };
}
