# Lumigift Escrow Contract — Event Schema

This document describes every event emitted by the Lumigift escrow contract
(`contracts/escrow/src/lib.rs`) for off-chain indexers, the event-indexer
service (`src/server/services/event-indexer.service.ts`), and the TypeScript
event decoder (`src/lib/contracts/escrow-events.ts`).

---

## Overview

The contract emits events via `env.events().publish(topics, data)` at the end
of each state-mutating function. Events are stored on the Stellar ledger and
are queryable via the Soroban RPC `getEvents` endpoint.

| Event name    | Emitted by    | Lifecycle state transition     |
|---------------|---------------|-------------------------------|
| `initialized` | `initialize`  | Uninitialized → Locked         |
| `claimed`     | `claim`       | Unlocked → Claimed (terminal)  |
| `cancelled`   | `cancel`      | Locked / Unlocked → Cancelled  |
| `upgraded`    | `upgrade`     | Admin-only contract upgrade    |

---

## Encoding conventions

All Soroban contract events follow the same XDR structure:

```
ContractEvent {
  topics: Vec<ScVal>   // discriminants / routing keys
  data:   ScVal        // payload (usually a ScVec)
}
```

- **Topics** are `ScVal` items used for filtering. The first topic is always a
  `Symbol` that names the event.
- **Data** is a single `ScVal` that wraps a `ScVec` of the payload fields in
  the order documented below.
- All Stellar addresses are encoded as `ScAddress` (variant `ScAddressTypeContract`
  for contract IDs, `ScAddressTypeAccount` for G-addresses).
- `i128` values are encoded as `ScVal::I128`.
- `u64` values are encoded as `ScVal::U64`.

---

## Events

### `initialized`

Emitted when the escrow is successfully created and funded.

**Topics**

| Index | Type     | Value           |
|-------|----------|-----------------|
| 0     | `Symbol` | `"initialized"` |

**Data** (`ScVec` with 4 elements)

| Index | Soroban type | TypeScript type | Description                              |
|-------|--------------|-----------------|------------------------------------------|
| 0     | `ScAddress`  | `string` (G…/C…)| `sender` — address that created the gift |
| 1     | `ScAddress`  | `string` (G…)   | `recipient` — address authorized to claim|
| 2     | `I128`       | `bigint`        | `amount` — locked amount in USDC stroops  |
| 3     | `U64`        | `bigint`        | `unlock_time` — Unix timestamp (seconds)  |

**TypeScript interface**

```typescript
interface InitializedEvent {
  type: "initialized";
  contractId: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  sender: string;      // Stellar address (G… or C…)
  recipient: string;   // Stellar address (G…)
  amount: bigint;      // USDC stroops (divide by 10_000_000 for USDC)
  unlockTime: bigint;  // Unix timestamp seconds
}
```

**Example fixture (testnet)**

```json
{
  "type": "initialized",
  "contractId": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "ledger": 1234567,
  "ledgerClosedAt": "2025-06-15T10:00:00Z",
  "txHash": "a1b2c3d4e5f6...",
  "sender": "GABC...1234",
  "recipient": "GXYZ...5678",
  "amount": "100000000",
  "unlockTime": "1750000000"
}
```

---

### `claimed`

Emitted when the recipient successfully claims the escrowed funds after the
unlock time has passed.

**Topics**

| Index | Type     | Value      |
|-------|----------|------------|
| 0     | `Symbol` | `"claimed"` |

**Data** (`ScVec` with 2 elements)

| Index | Soroban type | TypeScript type | Description                                  |
|-------|--------------|-----------------|----------------------------------------------|
| 0     | `ScAddress`  | `string` (G…)   | `recipient` — address that received the funds |
| 1     | `I128`       | `bigint`        | `amount` — transferred amount in USDC stroops |

**TypeScript interface**

```typescript
interface ClaimedEvent {
  type: "claimed";
  contractId: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  recipient: string;  // Stellar address (G…)
  amount: bigint;     // USDC stroops
}
```

**Example fixture (testnet)**

```json
{
  "type": "claimed",
  "contractId": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "ledger": 1240000,
  "ledgerClosedAt": "2025-07-01T12:00:00Z",
  "txHash": "f6e5d4c3b2a1...",
  "recipient": "GXYZ...5678",
  "amount": "100000000"
}
```

---

### `cancelled`

Emitted when the original sender cancels the escrow before the funds are claimed.
The full locked amount is returned to the sender.

**Topics**

| Index | Type     | Value         |
|-------|----------|---------------|
| 0     | `Symbol` | `"cancelled"` |

**Data** (`ScVec` with 2 elements)

| Index | Soroban type | TypeScript type | Description                                      |
|-------|--------------|-----------------|--------------------------------------------------|
| 0     | `ScAddress`  | `string` (G…/C…)| `sender` — address that received the refund      |
| 1     | `I128`       | `bigint`        | `amount` — refunded amount in USDC stroops        |

**TypeScript interface**

```typescript
interface CancelledEvent {
  type: "cancelled";
  contractId: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  sender: string;   // Stellar address (G… or C…)
  amount: bigint;   // USDC stroops
}
```

**Example fixture (testnet)**

```json
{
  "type": "cancelled",
  "contractId": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "ledger": 1236000,
  "ledgerClosedAt": "2025-06-20T08:30:00Z",
  "txHash": "1a2b3c4d5e6f...",
  "sender": "GABC...1234",
  "amount": "100000000"
}
```

---

### `upgraded`

Emitted when the admin upgrades the contract WASM. Allows indexers to track
contract version history.

**Topics**

| Index | Type     | Value       |
|-------|----------|-------------|
| 0     | `Symbol` | `"upgraded"` |

**Data** (`ScVec` with 2 elements)

| Index | Soroban type | TypeScript type | Description                            |
|-------|--------------|-----------------|----------------------------------------|
| 0     | `ScAddress`  | `string` (C…)   | Old contract address (pre-upgrade)     |
| 1     | `Bytes(32)`  | `string` (hex)  | New WASM hash (`BytesN<32>`)           |

> **Note:** The `upgraded` event is not decoded by `escrow-events.ts` today
> because it is an administrative operation. Indexers that need version
> tracking should add a decoder for it following the same pattern used for
> `initialized`.

---

## Versioning

Events are implicitly versioned by their topic name. Breaking changes to the
payload schema (adding, removing, or reordering fields) require a new topic
name (e.g. `initialized_v2`). Additive changes that append optional fields at
the end of the `ScVec` do not require a version bump but must be reflected in
this document.

Current schema version: **v1** (all events above).

---

## Indexer integration

The TypeScript event decoder is at `src/lib/contracts/escrow-events.ts`.
It exports:

- `fetchEscrowEvents(opts)` — fetches and decodes events from the RPC node
- `EscrowEvent` union type — `InitializedEvent | ClaimedEvent | CancelledEvent`
- `CURSOR_GENESIS` — sentinel cursor for full-history replay

The event-indexer service is at `src/server/services/event-indexer.service.ts`.
It persists the latest cursor to Redis so restarts resume from the last
processed event.

### Indexer fixture coverage

Each event type has an example fixture documented above. For automated fixture
testing, add JSON fixture files to `src/lib/contracts/__fixtures__/` following
the naming pattern `<event-type>.fixture.json` and validate them against the
TypeScript interfaces using the decoder.

---

## USDC amount formatting

All `amount` fields are in **USDC stroops** (7 decimal places).
To display as a human-readable USDC value:

```typescript
const usdc = Number(event.amount) / 10_000_000;
// e.g. 100_000_000 stroops → 10.0000000 USDC
```
