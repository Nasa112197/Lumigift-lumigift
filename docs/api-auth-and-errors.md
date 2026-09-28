# API Authentication and Error Contract

This document describes how to authenticate with the Lumigift API, how CSRF protection works, how cron and webhook endpoints are secured, and the full set of structured error codes that every response may return.

Interactive API reference: `GET /api/docs` (Swagger UI, served from `openapi.yaml`).

---

## Table of Contents

1. [Response Envelope](#1-response-envelope)
2. [Response Headers](#2-response-headers)
3. [Session Authentication (Phone OTP)](#3-session-authentication-phone-otp)
4. [CSRF Protection](#4-csrf-protection)
5. [Cron Endpoint Authentication](#5-cron-endpoint-authentication)
6. [Webhook Signature Verification](#6-webhook-signature-verification)
7. [Error Codes Reference](#7-error-codes-reference)
8. [HTTP Status Codes](#8-http-status-codes)
9. [Full Error Examples](#9-full-error-examples)

---

## 1. Response Envelope

Every endpoint returns a JSON object with a `success` discriminator:

**Success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "correlationId": "req_01HXY..."
}
```

- `code` is a stable string clients can `switch` on — it never changes between releases.
- `error` is a human-readable message that may change wording across releases; do not parse it.
- `correlationId` is present on all error responses. Include it when reporting issues.

---

## 2. Response Headers

Every API response carries two diagnostic headers regardless of success or failure:

| Header | Example | Description |
|---|---|---|
| `X-API-Version` | `v1` | API version string. Currently always `v1`. |
| `x-correlation-id` | `req_01HXY4Z...` | Unique request ID for tracing. Echo this in bug reports. |

You can supply your own correlation ID on the request — the server will use it:

```http
x-correlation-id: my-trace-id-12345
```

If omitted, the server generates one automatically.

---

## 3. Session Authentication (Phone OTP)

Most endpoints require a valid session. Authentication uses a two-step phone OTP flow powered by NextAuth.js.

### Step 1 — Request an OTP

```http
POST /api/v1/auth/send-otp
Content-Type: application/json

{
  "phone": "+2348012345678"
}
```

The server normalizes the phone number to E.164, generates a 6-digit OTP, stores it in Redis with a 10-minute TTL, and sends an SMS via Termii.

The response is always `200 OK` with the same body regardless of whether the number is registered. This prevents phone number enumeration:

```json
{
  "success": true,
  "data": {
    "message": "If this number is registered, an OTP has been sent."
  }
}
```

**Rate limits:**
- 3 requests per phone number per 10 minutes
- 10 requests per IP address per hour

Both limits return `429 Too Many Requests` with a `Retry-After` header on breach.

### Step 2 — Exchange OTP for Session

Submit the OTP to the NextAuth credentials provider:

```http
POST /api/v1/auth/[...nextauth]
Content-Type: application/json

{
  "phone": "+2348012345678",
  "otp": "123456"
}
```

On success, NextAuth sets a signed session cookie:

```
Set-Cookie: next-auth.session-token=<jwt>; HttpOnly; SameSite=Lax; Path=/
```

All subsequent requests must carry this cookie. The session is valid for the NextAuth-configured session lifetime (default 30 days).

### Authenticated Request Pattern

```http
GET /api/v1/gifts
Cookie: next-auth.session-token=<jwt>
x-csrf-token: <token-from-step-in-section-4>
```

### Session Errors

| Scenario | Code | HTTP |
|---|---|---|
| No session cookie | `UNAUTHORIZED` | 401 |
| Expired session JWT | `SESSION_EXPIRED` | 401 |
| Valid session but insufficient role | `FORBIDDEN` | 403 |

---

## 4. CSRF Protection

All state-mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) must include a valid CSRF token in the `x-csrf-token` header. This is a double-submit cookie pattern signed with `CSRF_SECRET`.

### Fetch a CSRF Token

```http
GET /api/v1/csrf
Cookie: next-auth.session-token=<jwt>
```

Response:
```json
{
  "success": true,
  "data": {
    "csrfToken": "abc123..."
  }
}
```

The token is scoped to the current session and expires after 1 hour.

### Include it on Mutating Requests

```http
POST /api/v1/gifts
Cookie: next-auth.session-token=<jwt>
x-csrf-token: abc123...
Content-Type: application/json

{ ... }
```

### CSRF Errors

If the token is missing or invalid, the server returns:

```json
{
  "success": false,
  "error": "Invalid CSRF token",
  "code": "UNAUTHORIZED",
  "correlationId": "req_01HXY..."
}
```

**Note:** The React frontend handles this automatically via the `useCsrf` hook (`src/hooks/useCsrf.ts`), which fetches and caches the token for all API calls.

---

## 5. Cron Endpoint Authentication

Internal scheduler endpoints are not session-protected — they accept a static bearer token instead:

```http
GET /api/v1/cron/unlock
Authorization: Bearer <CRON_SECRET>
```

If the header is missing or the secret does not match, the server returns `401 Unauthorized`.

Configure `CRON_SECRET` in your Vercel project environment variables and use the same value in your cron scheduler's HTTP headers. See `docs/environment-variables.md` for generation instructions.

**Cron endpoints:**

| Endpoint | Schedule | Purpose |
|---|---|---|
| `GET /api/v1/cron/unlock` | Every minute | Find `locked` gifts past `unlockAt` and process payouts |
| `GET /api/v1/cron/expire` | Daily | Mark `pending_payment` gifts stale after timeout |
| `GET /api/v1/cron/reconcile` | Hourly | Reconcile payment and blockchain state |
| `GET /api/v1/cron/index-events` | Every 5 min | Index Soroban contract events into the database |

---

## 6. Webhook Signature Verification

### Paystack

Paystack signs every webhook POST with an HMAC-SHA512 digest of the raw request body, delivered in the `x-paystack-signature` header.

The server rejects any request where `HMAC-SHA512(PAYSTACK_SECRET_KEY, body) !== x-paystack-signature`.

```http
POST /api/v1/payments
x-paystack-signature: <hmac-sha512-hex>
Content-Type: application/json

{
  "event": "charge.success",
  "data": {
    "reference": "ref_abc123",
    "status": "success",
    "metadata": { "giftId": "uuid-here" }
  }
}
```

Webhook processing is idempotent — duplicate `reference` values are silently acknowledged with `200 OK`.

**Error response on bad signature:**
```json
{
  "success": false,
  "error": "Invalid webhook signature",
  "code": "PAYMENT_INVALID_SIGNATURE"
}
```

### Stripe

Stripe signs webhook payloads with a `stripe-signature` header. The server uses the Stripe SDK's `constructEvent` method with `STRIPE_WEBHOOK_SECRET` to verify.

```http
POST /api/v1/payments/stripe/webhook
stripe-signature: t=1234567890,v1=<hmac>,v0=<hmac>
Content-Type: application/json

{ ... }
```

---

## 7. Error Codes Reference

All error codes are stable string constants defined in `src/server/errors.ts`.  
Clients should `switch` on `code`, not on `error` message text.

### Authentication & Authorization

| Code | HTTP | Description |
|---|---|---|
| `UNAUTHORIZED` | 401 | No session, invalid session, missing CSRF token, or invalid cron bearer token |
| `FORBIDDEN` | 403 | Session is valid but the user does not own the resource or lacks the required role |
| `SESSION_EXPIRED` | 401 | Session JWT has expired — re-authenticate via the OTP flow |

### Input Validation

| Code | HTTP | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body failed Zod schema validation — check the `error` message for field details |
| `INVALID_PAYLOAD` | 400 | Request body is structurally invalid (unparseable JSON, wrong content type) |

### Gift Domain

| Code | HTTP | Description |
|---|---|---|
| `GIFT_NOT_FOUND` | 404 | No gift exists with the given ID, or the caller does not own it |
| `GIFT_ALREADY_CLAIMED` | 409 | A claim was attempted on a gift that has already been claimed |
| `GIFT_NOT_UNLOCKED` | 409 | A claim was attempted on a gift whose `unlockAt` time has not yet passed |
| `GIFT_INVALID_STATE` | 409 | The requested operation is not valid for the gift's current status (e.g. cancelling a claimed gift) |
| `GIFT_DAILY_LIMIT` | 429 | The user has exceeded their daily NGN sending limit (`GIFT_DAILY_LIMIT_NGN`) |

### Payment Domain

| Code | HTTP | Description |
|---|---|---|
| `PAYMENT_FAILED` | 402 | The payment provider returned a failed charge — the gift was not funded |
| `PAYMENT_INVALID_SIGNATURE` | 401 | Webhook signature verification failed (Paystack or Stripe) |
| `IDEMPOTENCY_CONFLICT` | 409 | Two concurrent requests used the same idempotency key with different payloads |
| `RATE_SLIPPAGE` | 409 | The NGN/USDC exchange rate moved beyond the allowed slippage threshold since the rate was quoted |
| `RATE_EXPIRED` | 409 | The quoted exchange rate has expired (quotes are valid for 60 seconds) |

### Infrastructure

| Code | HTTP | Description |
|---|---|---|
| `RATE_LIMIT_EXCEEDED` | 429 | API-level rate limit exceeded. Response includes `Retry-After` header |
| `INTERNAL_ERROR` | 500 | An unexpected server-side error occurred. The `correlationId` in the response can be used to trace the error in server logs |

---

## 8. HTTP Status Codes

| Status | Meaning |
|---|---|
| `200 OK` | Request succeeded |
| `201 Created` | Resource created (gift creation) |
| `302 Found` | Redirect (Paystack callback) |
| `400 Bad Request` | Validation or payload error |
| `401 Unauthorized` | Missing or invalid auth |
| `402 Payment Required` | Payment provider returned a failure |
| `403 Forbidden` | Insufficient permissions |
| `404 Not Found` | Resource does not exist |
| `409 Conflict` | Action not allowed in current state |
| `429 Too Many Requests` | Rate limit exceeded |
| `500 Internal Server Error` | Unexpected server error |
| `502 Bad Gateway` | Upstream dependency failed (e.g. Cloudinary) |

---

## 9. Full Error Examples

### Missing session (401)

```http
GET /api/v1/gifts HTTP/1.1
Host: lumigift.com
```

```json
{
  "success": false,
  "error": "Unauthorized",
  "code": "UNAUTHORIZED",
  "correlationId": "req_01HXY4Z8ABCD"
}
```

### Validation failure (400)

```http
POST /api/v1/gifts HTTP/1.1
Content-Type: application/json

{
  "recipientName": "Amaka",
  "amountNgn": -100
}
```

```json
{
  "success": false,
  "error": "amountNgn: Number must be greater than 0; recipientPhone: Required",
  "code": "VALIDATION_ERROR",
  "correlationId": "req_01HXY4Z8WXYZ"
}
```

### Claim on a locked (not yet unlocked) gift (409)

```http
POST /api/v1/gifts/abc-123/claim HTTP/1.1
Content-Type: application/json

{ "giftId": "abc-123", "recipientStellarKey": "GABC...XYZ" }
```

```json
{
  "success": false,
  "error": "Gift is not yet unlocked",
  "code": "GIFT_NOT_UNLOCKED",
  "correlationId": "req_01HXY4Z8EFGH"
}
```

### Daily sending limit exceeded (429)

```json
{
  "success": false,
  "error": "You have reached your daily sending limit",
  "code": "GIFT_DAILY_LIMIT",
  "correlationId": "req_01HXY4Z8IJKL"
}
```

### Rate slippage (409)

```json
{
  "success": false,
  "error": "Exchange rate moved beyond allowed slippage. Please retry.",
  "code": "RATE_SLIPPAGE",
  "correlationId": "req_01HXY4Z8MNOP"
}
```

### Internal error (500)

```json
{
  "success": false,
  "error": "An unexpected error occurred. Please try again.",
  "code": "INTERNAL_ERROR",
  "correlationId": "req_01HXY4Z8QRST"
}
```

> When reporting this to support, include the `correlationId`. It maps directly to the corresponding log entry in the server logs.

---

## Related Documents

- `openapi.yaml` — machine-readable OpenAPI 3.0 spec (served at `GET /api/docs`)
- `docs/environment-variables.md` — `CSRF_SECRET`, `CRON_SECRET`, and webhook secret configuration
- `docs/architecture/gift-lifecycle.md` — gift state machine and valid operation windows
- `src/server/errors.ts` — error code definitions and `mapError` utility
- `src/server/middleware/index.ts` — `withAuth`, `withCsrf`, `withErrorHandler` middleware
- `src/lib/csrf.ts` — CSRF token generation and validation
