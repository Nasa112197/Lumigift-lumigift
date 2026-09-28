# Environment Variable Reference

Complete reference for every environment variable Lumigift reads at runtime.  
Variables are validated on startup by a Zod schema in `src/server/config/env.ts` — the server will refuse to start if a required variable is missing or malformed.

> **Security note:** Never commit real credentials to version control.  
> Copy `.env.example` to `.env.local` (git-ignored) and fill in your own values.  
> Generate random secrets with: `openssl rand -base64 32`

---

## Table of Contents

1. [Application](#1-application)
2. [Authentication](#2-authentication)
3. [CSRF Protection](#3-csrf-protection)
4. [Database](#4-database)
5. [Stellar / Soroban Blockchain](#5-stellar--soroban-blockchain)
6. [USDC Asset](#6-usdc-asset)
7. [Payments — Paystack (NGN)](#7-payments--paystack-ngn)
8. [Payments — Stripe (International)](#8-payments--stripe-international)
9. [SMS / OTP](#9-sms--otp)
10. [Cron / Scheduler](#10-cron--scheduler)
11. [Redis](#11-redis)
12. [Gift Amount Limits](#12-gift-amount-limits)
13. [Cloudinary (Media Uploads)](#13-cloudinary-media-uploads)
14. [Error Monitoring — Sentry](#14-error-monitoring--sentry)
15. [Variable Quick-Reference Table](#15-variable-quick-reference-table)

---

## 1. Application

These variables configure the app's public identity and base URL.

### `NEXT_PUBLIC_APP_URL`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server + Client (prefixed `NEXT_PUBLIC_`) |
| **Format** | Full URL with protocol — no trailing slash |
| **Example** | `http://localhost:3000` |

Base URL where the app is hosted. Used for redirect URLs, webhook callback registration, and email links.

- Local dev: `http://localhost:3000`
- Production: `https://lumigift.com`

### `NEXT_PUBLIC_APP_NAME`

| | |
|---|---|
| **Required** | No (default: `"Lumigift"`) |
| **Scope** | Server + Client |
| **Format** | Plain text string |
| **Example** | `Lumigift` |

Display name shown in the UI, notification messages, and SMS templates.

---

## 2. Authentication

Lumigift uses [NextAuth.js](https://next-auth.js.org/) with a phone OTP credential provider.  
Sessions are stored in signed JWT cookies.

### `NEXTAUTH_URL`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only |
| **Format** | Full URL — must match `NEXT_PUBLIC_APP_URL` |
| **Example** | `http://localhost:3000` |

Canonical URL used by NextAuth for callback URL construction and session validation.  
Must match the origin the browser is actually using.

### `NEXTAUTH_SECRET`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only — never expose to client |
| **Format** | Random string, minimum 32 characters |
| **Example** | *(not shown — generate your own)* |
| **Generate** | `openssl rand -base64 32` |

Secret used to sign and encrypt JWT session tokens and session cookies.  
Changing this value invalidates all existing sessions.

### `NEXTAUTH_SECRET_PREVIOUS`

| | |
|---|---|
| **Required** | No |
| **Scope** | Server only |
| **Format** | Same as `NEXTAUTH_SECRET` |
| **Example** | *(not shown)* |

Previous secret key used during key rotation.  
Set this to the old `NEXTAUTH_SECRET` when rotating so existing sessions remain valid during the grace period.  
Remove this variable after `NEXTAUTH_ROTATION_GRACE_HOURS` has elapsed.  
See `docs/ops/key-rotation.md` for the full rotation procedure.

### `NEXTAUTH_ROTATION_GRACE_HOURS`

| | |
|---|---|
| **Required** | No (default: `24`) |
| **Scope** | Server only |
| **Format** | Integer (hours) |
| **Example** | `24` |

Number of hours that tokens signed with `NEXTAUTH_SECRET_PREVIOUS` remain valid after rotation.

---

## 3. CSRF Protection

### `CSRF_SECRET`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only — never expose to client |
| **Format** | Hex string, minimum 32 characters |
| **Example** | *(not shown — generate your own)* |
| **Generate** | `openssl rand -hex 32` |

Secret used to sign double-submit CSRF tokens (`src/lib/csrf.ts`).  
All state-mutating API routes (`POST`, `PUT`, `DELETE`) validate a CSRF token in the `x-csrf-token` header, which the browser obtains from `GET /api/v1/csrf`.

---

## 4. Database

Lumigift uses PostgreSQL via the `pg` driver.

### `DATABASE_URL`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only — contains credentials |
| **Format** | `postgresql://username:password@host:port/database` |
| **Example** | `postgresql://lumigift:lumigift@localhost:5432/lumigift` |

Full PostgreSQL connection string.  
Production deployments should use a managed database URL (Vercel Postgres, Supabase, AWS RDS) stored in the deployment environment, never in a committed file.

### `DB_POOL_MIN`

| | |
|---|---|
| **Required** | No (default: `2`) |
| **Scope** | Server only |
| **Format** | Positive integer |
| **Example** | `2` |

Minimum number of idle connections maintained in the connection pool.

### `DB_POOL_MAX`

| | |
|---|---|
| **Required** | No (default: `10`) |
| **Scope** | Server only |
| **Format** | Positive integer |
| **Example** | `10` |

Maximum number of concurrent connections in the pool. Keep below the database plan's connection limit.

### `DB_IDLE_TIMEOUT_MS`

| | |
|---|---|
| **Required** | No (default: `10000`) |
| **Scope** | Server only |
| **Format** | Integer (milliseconds) |
| **Example** | `10000` |

Time in milliseconds before an idle connection is closed and removed from the pool.

### `DB_CONNECTION_TIMEOUT_MS`

| | |
|---|---|
| **Required** | No (default: `5000`) |
| **Scope** | Server only |
| **Format** | Integer (milliseconds) |
| **Example** | `5000` |

Maximum time to wait when acquiring a connection from the pool before throwing an error.

---

## 5. Stellar / Soroban Blockchain

These variables configure the app's connection to the Stellar network and the Soroban escrow smart contract.

### `STELLAR_NETWORK`

| | |
|---|---|
| **Required** | No (default: `"testnet"`) |
| **Scope** | Server only |
| **Format** | `"testnet"` or `"mainnet"` |
| **Example** | `testnet` |

Which Stellar network to connect to. Use `testnet` for all local and staging environments.

### `STELLAR_HORIZON_URL`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only |
| **Format** | Full HTTPS URL |
| **Testnet** | `https://horizon-testnet.stellar.org` |
| **Mainnet** | `https://horizon.stellar.org` |

Stellar Horizon API endpoint used for account queries, transaction submission, and event streaming.

### `STELLAR_NETWORK_PASSPHRASE`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only |
| **Format** | Exact network passphrase string |
| **Testnet** | `Test SDF Network ; September 2015` |
| **Mainnet** | `Public Global Stellar Network ; September 2015` |

Network passphrase included in transaction envelopes for replay protection.  
Must match the network specified in `STELLAR_NETWORK`.

### `STELLAR_ESCROW_CONTRACT_ID`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only |
| **Format** | Soroban contract address starting with `C` |
| **Example** | `CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM` |

Address of the deployed Soroban escrow contract (`contracts/escrow`).  
Obtain by running `npm run contract:deploy` and copying the printed contract ID.

### `STELLAR_SERVER_SECRET_KEY`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only — critical secret, never expose |
| **Format** | Stellar secret key starting with `S`, 56 characters |
| **Example** | *(not shown — generate your own)* |
| **Generate** | `stellar keys generate --global lumigift-dev --network testnet` |

Server-side Stellar secret key used to sign contract deployment and escrow funding transactions.  
In production, store in AWS Secrets Manager or HashiCorp Vault — never in a config file.  
See `docs/ops/key-rotation.md` for the key rotation procedure.

### `STELLAR_RPC_URL`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only |
| **Format** | Full HTTPS URL |
| **Testnet** | `https://soroban-testnet.stellar.org` |
| **Mainnet** | `https://soroban-rpc.stellar.org` |

Soroban RPC endpoint used for smart contract invocations and event indexing.

### `STELLAR_SERVER_PUBLIC_KEY`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only |
| **Format** | Stellar public key starting with `G`, 56 characters |
| **Example** | `GABC...XYZ` |
| **Derive** | `stellar keys address lumigift-dev` |

Public key corresponding to `STELLAR_SERVER_SECRET_KEY`.  
Used for RPC simulations and to verify that transactions are signed by the expected authority.

---

## 6. USDC Asset

### `USDC_ISSUER`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only |
| **Format** | Stellar public key (`G…`) |
| **Testnet** | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| **Mainnet** | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |

Stellar account that issues the USDC tokens used in escrow.  
This is Circle's official USDC issuer for each network — do not change it.

### `USDC_ASSET_CODE`

| | |
|---|---|
| **Required** | No (default: `"USDC"`) |
| **Scope** | Server only |
| **Format** | String, max 12 characters |
| **Example** | `USDC` |

Asset code for the stablecoin. Should always be `USDC`.

---

## 7. Payments — Paystack (NGN)

Paystack handles Nigerian Naira (NGN) on-ramp payments.

### `PAYSTACK_SECRET_KEY`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only — never expose to client |
| **Format** | `sk_test_…` (sandbox) or `sk_live_…` (production) |
| **Obtain** | [Paystack Dashboard → Settings → API Keys](https://dashboard.paystack.com/#/settings/developers) |

Secret key for server-side Paystack API calls (charge initialization, refunds, verification).  
Use the **test key** in development and staging environments.

### `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server + Client |
| **Format** | `pk_test_…` (sandbox) or `pk_live_…` (production) |
| **Obtain** | Same Paystack dashboard page |

Public key used to initialize the Paystack Popup on the frontend.  
Safe to expose to the browser.

---

## 8. Payments — Stripe (International)

Stripe handles international card payments.

### `STRIPE_SECRET_KEY`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only — never expose to client |
| **Format** | `sk_test_…` (sandbox) or `sk_live_…` (production) |
| **Obtain** | [Stripe Dashboard → Developers → API Keys](https://dashboard.stripe.com/apikeys) |

Secret key for server-side Stripe API calls (payment intents, refunds).

### `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server + Client |
| **Format** | `pk_test_…` (sandbox) or `pk_live_…` (production) |
| **Obtain** | Same Stripe dashboard page |

Publishable key for initializing Stripe Elements in the browser.

### `STRIPE_WEBHOOK_SECRET`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only — never expose to client |
| **Format** | `whsec_…` |
| **Obtain** | [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks) |

Signing secret used to verify `stripe-signature` headers on incoming webhook events.  
The webhook endpoint is `POST /api/v1/payments/stripe/webhook`.  
Register `{NEXT_PUBLIC_APP_URL}/api/v1/payments/stripe/webhook` as the endpoint URL in the Stripe dashboard and set this to the secret it provides.

---

## 9. SMS / OTP

Lumigift sends one-time passwords via Termii SMS.

### `TERMII_API_KEY`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only — never expose to client |
| **Format** | Alphanumeric string |
| **Obtain** | [Termii Dashboard → API Settings](https://accounts.termii.com/#/api-settings) |

API key for the Termii messaging service.  
Free trial keys are available for development.

### `TERMII_SENDER_ID`

| | |
|---|---|
| **Required** | No (default: `"Lumigift"`) |
| **Scope** | Server only |
| **Format** | Alphanumeric, max 11 characters |
| **Example** | `Lumigift` |

Sender name shown on OTP SMS messages. Must be registered and approved in the Termii dashboard.

---

## 10. Cron / Scheduler

Internal cron endpoints (`/api/v1/cron/*`) are authenticated with a static bearer token to prevent unauthorized triggering.

### `CRON_SECRET`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only — never expose to client |
| **Format** | Random string, minimum 32 characters |
| **Example** | *(not shown — generate your own)* |
| **Generate** | `openssl rand -base64 32` |

Static secret included in cron job requests as `Authorization: Bearer <CRON_SECRET>`.  
Configure this value in Vercel's cron settings or your external scheduler.  
See `openapi.yaml` for the `cronBearer` security scheme definition.

---

## 11. Redis

Redis is used for session caching, OTP storage, and job queuing.

### `REDIS_URL`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only |
| **Format** | `redis://[username:password@]host:port[/database]` |
| **Example** | `redis://localhost:6379` |

Connection URL for the Redis instance.  
Local dev: start Redis with `docker compose up -d`.  
Production: use a managed Redis (Upstash, Redis Cloud, AWS ElastiCache).

---

## 12. Gift Amount Limits

These variables enforce AML (anti-money laundering) and regulatory limits on gift amounts.  
All values are in Nigerian Naira (NGN) with no decimal component.

### `GIFT_MIN_AMOUNT_NGN`

| | |
|---|---|
| **Required** | No (default: `500`) |
| **Scope** | Server only |
| **Format** | Positive integer (NGN) |
| **Example** | `500` |

Minimum allowed gift amount. Prevents micro-transaction abuse.

### `GIFT_MAX_AMOUNT_NGN`

| | |
|---|---|
| **Required** | No (default: `500000`) |
| **Scope** | Server only |
| **Format** | Positive integer (NGN) |
| **Example** | `500000` |

Maximum allowed gift amount per single transaction.

### `GIFT_DAILY_LIMIT_NGN`

| | |
|---|---|
| **Required** | No (default: `1000000`) |
| **Scope** | Server only |
| **Format** | Positive integer (NGN) |
| **Example** | `1000000` |

Maximum total gift amount a single user may send in a rolling 24-hour window.  
Exceeding this limit returns error code `GIFT_DAILY_LIMIT` (HTTP 429).

---

## 13. Cloudinary (Media Uploads)

Gift cards can include an image or short video uploaded to Cloudinary.

### `CLOUDINARY_CLOUD_NAME`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only |
| **Format** | String (your Cloudinary cloud name) |
| **Obtain** | [Cloudinary Console → Dashboard → Account Details](https://console.cloudinary.com/console) |

Your Cloudinary cloud identifier.

### `CLOUDINARY_API_KEY`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only |
| **Format** | Numeric string |
| **Obtain** | Same Cloudinary Console page |

API key for authenticating server-side upload requests.

### `CLOUDINARY_API_SECRET`

| | |
|---|---|
| **Required** | Yes |
| **Scope** | Server only — never expose to client |
| **Format** | Alphanumeric string |
| **Obtain** | Same Cloudinary Console page |

API secret used to sign upload parameters. Never include in client-side code or API responses.

---

## 14. Error Monitoring — Sentry

### `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`

| | |
|---|---|
| **Required** | No (monitoring disabled if unset) |
| **Scope** | `SENTRY_DSN` — server only; `NEXT_PUBLIC_SENTRY_DSN` — client + server |
| **Format** | Sentry DSN URL |
| **Obtain** | [sentry.io → Project Settings → Client Keys (DSN)](https://sentry.io) |

Data Source Name for sending error reports to Sentry.  
Both variables should be set to the same DSN value.

### `SENTRY_ORG`

| | |
|---|---|
| **Required** | No (only needed for CI source-map uploads) |
| **Scope** | CI/CD build environment only |
| **Format** | Sentry organization slug |
| **Obtain** | Sentry → Organization Settings → General → Organization Slug |

### `SENTRY_PROJECT`

| | |
|---|---|
| **Required** | No (only needed for CI source-map uploads) |
| **Scope** | CI/CD build environment only |
| **Format** | Sentry project slug |
| **Obtain** | Sentry → Project Settings → General → Project Slug |

### `SENTRY_AUTH_TOKEN`

| | |
|---|---|
| **Required** | No (only needed for CI source-map uploads) |
| **Scope** | CI/CD build environment only — never expose at runtime |
| **Format** | Sentry auth token string |
| **Obtain** | Sentry → User Settings → Auth Tokens |

Used by the Sentry webpack plugin during `next build` to upload source maps.  
Store as a CI secret (e.g., GitHub Actions secret) — never in `.env.local`.

---

## 15. Variable Quick-Reference Table

| Variable | Required | Scope | Default |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | ✅ | Server + Client | — |
| `NEXT_PUBLIC_APP_NAME` | No | Server + Client | `Lumigift` |
| `NEXTAUTH_URL` | ✅ | Server | — |
| `NEXTAUTH_SECRET` | ✅ | Server | — |
| `NEXTAUTH_SECRET_PREVIOUS` | No | Server | — |
| `NEXTAUTH_ROTATION_GRACE_HOURS` | No | Server | `24` |
| `CSRF_SECRET` | ✅ | Server | — |
| `DATABASE_URL` | ✅ | Server | — |
| `DB_POOL_MIN` | No | Server | `2` |
| `DB_POOL_MAX` | No | Server | `10` |
| `DB_IDLE_TIMEOUT_MS` | No | Server | `10000` |
| `DB_CONNECTION_TIMEOUT_MS` | No | Server | `5000` |
| `STELLAR_NETWORK` | No | Server | `testnet` |
| `STELLAR_HORIZON_URL` | ✅ | Server | — |
| `STELLAR_NETWORK_PASSPHRASE` | ✅ | Server | — |
| `STELLAR_ESCROW_CONTRACT_ID` | ✅ | Server | — |
| `STELLAR_SERVER_SECRET_KEY` | ✅ | Server | — |
| `STELLAR_RPC_URL` | ✅ | Server | — |
| `STELLAR_SERVER_PUBLIC_KEY` | ✅ | Server | — |
| `USDC_ISSUER` | ✅ | Server | — |
| `USDC_ASSET_CODE` | No | Server | `USDC` |
| `PAYSTACK_SECRET_KEY` | ✅ | Server | — |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | ✅ | Server + Client | — |
| `STRIPE_SECRET_KEY` | ✅ | Server | — |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ | Server + Client | — |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Server | — |
| `TERMII_API_KEY` | ✅ | Server | — |
| `TERMII_SENDER_ID` | No | Server | `Lumigift` |
| `CRON_SECRET` | ✅ | Server | — |
| `REDIS_URL` | ✅ | Server | — |
| `GIFT_MIN_AMOUNT_NGN` | No | Server | `500` |
| `GIFT_MAX_AMOUNT_NGN` | No | Server | `500000` |
| `GIFT_DAILY_LIMIT_NGN` | No | Server | `1000000` |
| `CLOUDINARY_CLOUD_NAME` | ✅ | Server | — |
| `CLOUDINARY_API_KEY` | ✅ | Server | — |
| `CLOUDINARY_API_SECRET` | ✅ | Server | — |
| `SENTRY_DSN` | No | Server | — |
| `NEXT_PUBLIC_SENTRY_DSN` | No | Server + Client | — |
| `SENTRY_ORG` | No | CI only | — |
| `SENTRY_PROJECT` | No | CI only | — |
| `SENTRY_AUTH_TOKEN` | No | CI only | — |

---

## Related Documents

- `.env.example` — annotated template for all variables
- `.env.local.example` — Docker Compose local dev template
- `docs/ops/key-rotation.md` — rotating `NEXTAUTH_SECRET` and `STELLAR_SERVER_SECRET_KEY`
- `docs/local-dev-setup.md` — step-by-step local setup guide
- `docs/troubleshooting.md` — diagnosing startup failures and misconfigured variables
- `src/server/config/env.ts` — Zod validation schema (source of truth for all defaults and formats)
