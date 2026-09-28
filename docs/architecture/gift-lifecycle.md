# Gift Lifecycle and State Transitions

This document is the authoritative reference for the Lumigift gift state machine.  
It covers every state, every valid transition, the actor that triggers each transition, terminal behavior, and failure paths.

The state machine is enforced at runtime by `src/server/services/gift-state-machine.ts` (`assertValidTransition`) and validated at rest by the TypeScript `GiftStatus` type in `src/types/index.ts`.

---

## Table of Contents

1. [States Overview](#1-states-overview)
2. [State Transition Diagram](#2-state-transition-diagram)
3. [Transition Table](#3-transition-table)
4. [State Definitions](#4-state-definitions)
   - [draft](#draft)
   - [pending_payment](#pending_payment)
   - [funded](#funded)
   - [locked](#locked)
   - [unlocked](#unlocked)
   - [claimed](#claimed)
   - [cancelled](#cancelled)
   - [expired](#expired)
5. [Blockchain Interactions](#5-blockchain-interactions)
6. [Payment Flow Detail](#6-payment-flow-detail)
7. [Cron Job Responsibilities](#7-cron-job-responsibilities)
8. [Failure Scenarios and Recovery](#8-failure-scenarios-and-recovery)
9. [Reconciliation](#9-reconciliation)

---

## 1. States Overview

| State | Terminal? | Owner | Description |
|---|---|---|---|
| `draft` | No | Sender | Gift form filled, payment not yet initiated |
| `pending_payment` | No | Payment provider | Awaiting Paystack charge confirmation |
| `funded` | No | System | Payment confirmed, contract deployment pending |
| `locked` | No | Smart contract | USDC locked in Soroban escrow until `unlockAt` |
| `unlocked` | No | System / Recipient | `unlockAt` has passed, claim available |
| `claimed` | **Yes** | Recipient | USDC transferred to recipient's Stellar wallet |
| `cancelled` | **Yes** | Sender / System | Gift cancelled, refund issued if funded |
| `expired` | **Yes** | System (cron) | Unclaimed after 365 days, USDC returned to sender |

---

## 2. State Transition Diagram

```
                          ┌──────────┐
                          │  START   │
                          └────┬─────┘
                               │ createGift()
                               ▼
                          ┌──────────┐
                     ┌───▶│  draft   │
                     │    └────┬─────┘
                     │         │ submit payment
                     │         ▼
                     │  ┌─────────────────┐
              cancel │  │ pending_payment │
                     │  └────┬────────────┘
                     │       │ Paystack charge.success
                     │       ▼
                     │  ┌──────────┐
                     ├──│  funded  │
                     │  └────┬─────┘
                     │       │ escrow contract deployed + funded
                     │       ▼
                     │  ┌──────────┐
                     ├──│  locked  │
                     │  └────┬─────┘
                     │       │ cron/unlock (unlockAt passed)
                     │       ▼
                     │  ┌──────────┐
                     ├──│ unlocked │─────────────────────────┐
                     │  └────┬─────┘                         │
                     │       │ claimGift()                   │ 365 days unclaimed
                     │       ▼                               ▼
                     │  ┌──────────┐               ┌─────────────┐
                     │  │ claimed  │               │   expired   │
                     │  └──────────┘               └─────────────┘
                     │  (terminal)                  (terminal)
                     │
                     └──▶ ┌───────────┐
                          │ cancelled │
                          └───────────┘
                          (terminal)
```

---

## 3. Transition Table

| From | To | Triggered by | API / Actor |
|---|---|---|---|
| `draft` | `pending_payment` | User submits payment | `POST /api/v1/gifts` → redirect to Paystack |
| `draft` | `cancelled` | User cancels | `DELETE /api/v1/gifts/:id` |
| `pending_payment` | `funded` | Payment confirmed | Paystack `charge.success` webhook |
| `pending_payment` | `cancelled` | Payment failure / timeout | Paystack failure event or expiry cron |
| `funded` | `locked` | Contract deployed and funded | `gift.service.ts` (background, after webhook) |
| `funded` | `cancelled` | Contract deployment failure | `gift.service.ts` error path |
| `locked` | `unlocked` | `unlockAt` timestamp passed | `GET /api/v1/cron/unlock` (scheduler) |
| `locked` | `cancelled` | Sender cancels before unlock | `DELETE /api/v1/gifts/:id` |
| `unlocked` | `claimed` | Recipient claims | `POST /api/v1/gifts/:id/claim` |
| `unlocked` | `expired` | 365 days unclaimed | `GET /api/v1/cron/expire` (scheduler) |
| `unlocked` | `cancelled` | Sender cancels after unlock | `DELETE /api/v1/gifts/:id` (edge case) |

Any attempt to perform a transition not listed above is rejected by `assertValidTransition` with error code `GIFT_INVALID_STATE` (HTTP 409).

---

## 4. State Definitions

### `draft`

**Owner:** Sender  
**Terminal:** No  
**Database:** `status = 'draft'`, no `contractId`, no `stellarTxHash`  
**Contract:** None deployed

The gift record has been created from the send form but payment has not been initiated.  
The gift may exist in this state for up to the session duration before being submitted.

**Valid transitions:**
- `pending_payment` — sender proceeds to payment
- `cancelled` — sender abandons

---

### `pending_payment`

**Owner:** Payment provider (Paystack)  
**Terminal:** No  
**Database:** `status = 'pending_payment'`, no `contractId`  
**Contract:** None deployed

The user has been redirected to Paystack's checkout. The app is waiting for a `charge.success` webhook.

Gifts stuck in this state for more than the configured timeout (default: 30 minutes) are automatically cancelled by the expiry cron job.

**Valid transitions:**
- `funded` — Paystack webhook confirms successful charge
- `cancelled` — payment failure, user abandons, or expiry timeout

---

### `funded`

**Owner:** System  
**Terminal:** No  
**Database:** `status = 'funded'`, no `contractId`, `stellarTxHash` may be set if funds were transferred pre-deployment  
**Contract:** None deployed yet

Payment has been confirmed. The service layer now attempts to deploy and fund the Soroban escrow contract asynchronously. This state should be transient — typically milliseconds — but may persist longer if the Stellar network is congested.

**Valid transitions:**
- `locked` — contract deployed and funded successfully
- `cancelled` — contract deployment failed after all retries

---

### `locked`

**Owner:** Smart contract (Soroban escrow)  
**Terminal:** No  
**Database:** `status = 'locked'`, `contractId` set, `stellarTxHash` set  
**Contract:** Initialized with `(sender, recipient, USDC, amount, unlockTime)` and funded with USDC

The gift's USDC is held in the time-locked Soroban escrow contract. No party can withdraw until `unlockAt` passes. The sender may still cancel (triggers a contract `cancel` call and Paystack refund).

Gifts in this state are invisible to the recipient until the status advances to `unlocked`.

**Valid transitions:**
- `unlocked` — cron job processes unlock after `unlockAt`
- `cancelled` — sender cancels before `unlockAt`

---

### `unlocked`

**Owner:** System / Recipient  
**Terminal:** No  
**Database:** `status = 'unlocked'`, `contractId` present  
**Contract:** Funds still held in contract, `unlock_time` has passed

The recipient may now claim the gift. The surprise is revealed — the frontend displays the gift card in full, and the claim button becomes active. Notifications (SMS and/or email) are sent to the recipient.

**Valid transitions:**
- `claimed` — recipient submits a valid Stellar public key and the claim succeeds
- `expired` — 365 days pass without a claim (cron job)
- `cancelled` — sender cancels (edge case; refund process triggered)

---

### `claimed`

**Owner:** Recipient  
**Terminal:** Yes ✅  
**Database:** `status = 'claimed'`, `claimTxHash` set to the Stellar transaction hash  
**Contract:** `claimed = true`, funds transferred out to recipient's Stellar address

The USDC has been delivered. No further state changes are possible. The sender's dashboard shows the gift as claimed with the claim timestamp.

---

### `cancelled`

**Owner:** Sender / System  
**Terminal:** Yes ✅  
**Database:** `status = 'cancelled'`  
**Contract:** If contract was deployed, a `cancel` call is attempted; if funded, a Paystack refund is issued

A catch-all terminal state for any abandonment or failure path.  
The refund behavior depends on how far the gift progressed:

| Stage at cancellation | Refund |
|---|---|
| `draft` / `pending_payment` | No charge yet — no refund needed |
| `funded` (contract failed) | Paystack refund initiated |
| `locked` / `unlocked` | Paystack refund + Soroban contract cancel (returns USDC to server account for settlement) |

---

### `expired`

**Owner:** System (cron job)  
**Terminal:** Yes ✅  
**Database:** `status = 'expired'`  
**Contract:** Refund transaction submitted to return USDC to sender's Stellar address (or server account for NGN settlement)

Applied by the daily expiry cron job to `unlocked` gifts that have not been claimed within 365 days of `unlockAt`. The sender receives a refund notification.

---

## 5. Blockchain Interactions

### Contract Initialization (`funded` → `locked`)

Called by `gift.service.ts` after a successful payment webhook:

1. Generate a fresh Soroban contract instance from the escrow WASM.
2. Call `initialize(sender_key, recipient_key, usdc_asset, amount_stroop, unlock_time_unix)`.
3. Transfer USDC from the server account to the contract address.
4. Persist `contractId` and `stellarTxHash` to the database.
5. Advance status to `locked`.

**Retry policy:** 3 attempts with exponential backoff (1 s, 4 s, 16 s).  
After all retries fail the gift is moved to `cancelled` and a Paystack refund is issued.

### Unlock (`locked` → `unlocked`)

The cron job does **not** interact with the contract for unlocking — it simply updates the database status after confirming the wall-clock time has passed. The contract's time-lock is enforced at claim time.

### Claim (`unlocked` → `claimed`)

Called by `claim.service.ts` when the recipient submits their Stellar public key:

1. Validate the recipient key format (`G…`).
2. Call `contract.claim(recipient_key)` on the Soroban contract.
3. The contract verifies: `now >= unlock_time` and `!claimed`.
4. Contract transfers USDC to `recipient_key`.
5. Persist `claimTxHash` and advance status to `claimed`.
6. Send confirmation notifications.

### Cancellation (`locked` or `unlocked` → `cancelled`)

1. Call `contract.cancel()` — requires the sender's signature.
2. Contract returns USDC to the server account.
3. Server initiates a Paystack refund equivalent to the original NGN amount.
4. Persist status `cancelled`.

---

## 6. Payment Flow Detail

```
Sender browser         Next.js API          Paystack         Stellar
      │                     │                   │                │
      │  POST /api/v1/gifts  │                   │                │
      │─────────────────────▶│                   │                │
      │                     │ initTransaction()  │                │
      │                     │──────────────────▶│                │
      │                     │ paymentUrl         │                │
      │◀─────────────────────│                   │                │
      │                     │                   │                │
      │  redirect to Paystack│                   │                │
      │──────────────────────────────────────▶  │                │
      │  complete checkout   │                   │                │
      │                     │  charge.success    │                │
      │                     │◀──────────────────│                │
      │                     │                   │                │
      │                     │  deployContract()  │                │
      │                     │─────────────────────────────────▶  │
      │                     │  contractId + txHash               │
      │                     │◀────────────────────────────────── │
      │                     │                   │                │
      │  redirect to /gifts/:id (status: locked) │               │
      │◀─────────────────────│                   │                │
```

---

## 7. Cron Job Responsibilities

| Endpoint | Frequency | Action |
|---|---|---|
| `GET /api/v1/cron/unlock` | Every minute | Query `locked` gifts where `unlockAt <= NOW()`. Advance status to `unlocked`. Send recipient notifications. |
| `GET /api/v1/cron/expire` | Daily | Query `pending_payment` gifts older than 30 minutes. Move to `cancelled`. Query `unlocked` gifts older than 365 days. Move to `expired` and trigger refund. |
| `GET /api/v1/cron/reconcile` | Hourly | Query `funded` gifts older than 5 minutes (contract deployment should be near-instant). Retry deployment or escalate. |
| `GET /api/v1/cron/index-events` | Every 5 minutes | Fetch new Soroban events from RPC and persist to `contract_events` table. |

All cron endpoints require `Authorization: Bearer <CRON_SECRET>` and are designed to be idempotent — running them multiple times produces the same outcome.

---

## 8. Failure Scenarios and Recovery

### Payment succeeded, contract deployment failed

- **Symptom:** Gift stuck in `funded` for more than 5 minutes.
- **Detection:** `GET /api/v1/cron/reconcile` or alerting on `funded_duration > 5min`.
- **Recovery:** Reconciliation cron retries deployment up to 3 times. If all retries fail, the gift moves to `cancelled` and a Paystack refund is issued automatically.
- **Manual path:** Admin can trigger re-deployment or force-cancel via `PATCH /api/v1/admin/gifts/:id`.

### Cron unlock job failed silently

- **Symptom:** `locked` gifts remain locked past `unlockAt`.
- **Detection:** Monitor cron execution logs. Alert if a gift is `locked` more than 2 minutes past `unlockAt`.
- **Recovery:** Re-trigger `GET /api/v1/cron/unlock` manually with the cron bearer token. Idempotent — safe to run multiple times.

### Claim transaction rejected by Stellar

- **Symptom:** `POST /api/v1/gifts/:id/claim` returns a Stellar error; gift remains `unlocked`.
- **Common causes:**
  - Recipient account has no USDC trustline → `GIFT_NOT_UNLOCKED` (or Stellar `op_no_trust`)
  - Contract already claimed by another request → `GIFT_ALREADY_CLAIMED`
  - Network congestion / timeout
- **Recovery:** Recipient can retry the claim. The endpoint is idempotent on a successful Stellar transaction.

### Stellar network outage

- **Symptom:** Contract deployments and claims fail intermittently with connection errors.
- **Detection:** Monitor `INTERNAL_ERROR` rate on gift-related endpoints.
- **Recovery:** Gifts remain in their current state. Retries succeed automatically once the network recovers. No manual intervention needed unless gifts have been in transitional states for more than the reconciliation threshold.

---

## 9. Reconciliation

The reconciliation cron (`GET /api/v1/cron/reconcile`) is the backstop for gifts that fall out of sync between the PostgreSQL database and the Stellar network.

It handles:
- `funded` gifts where contract deployment was never confirmed (retry or cancel)
- `locked` gifts where the on-chain contract shows the funds have already been released (advance to `unlocked` or `claimed`)
- Any gift where the database status conflicts with the contract state

Reconciliation results are logged with the `correlationId` of the cron run and can be viewed in the server logs or Sentry.

---

## Related Documents

- `src/server/services/gift-state-machine.ts` — `isValidTransition` / `assertValidTransition`
- `src/server/services/gift.service.ts` — state transition logic
- `src/server/services/claim.service.ts` — claim flow
- `src/server/services/scheduler.service.ts` — unlock and expiry scheduling
- `src/server/services/payment-reconciliation.service.ts` — reconciliation logic
- `contracts/escrow/src/lib.rs` — Soroban escrow contract
- `docs/contract-events.md` — Soroban event schema
- `docs/api-auth-and-errors.md` — error codes for state transition failures (`GIFT_INVALID_STATE`, `GIFT_NOT_UNLOCKED`, `GIFT_ALREADY_CLAIMED`)
- `docs/ops/runbook.md` — operational procedures for stuck gifts
