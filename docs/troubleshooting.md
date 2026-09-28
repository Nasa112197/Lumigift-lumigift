# Local Development Troubleshooting Guide

Step-by-step diagnosis for the most common problems encountered when running Lumigift locally.  
Each section lists symptoms, diagnostic commands, and resolution steps.

> **Destructive reset commands are marked with ⚠️ DESTRUCTIVE.**  
> These delete data or wipe state permanently — read the warning before running them.

---

## Table of Contents

1. [Docker and Container Issues](#1-docker-and-container-issues)
2. [Database (PostgreSQL) Issues](#2-database-postgresql-issues)
3. [Redis Issues](#3-redis-issues)
4. [Environment Variable Errors](#4-environment-variable-errors)
5. [Stellar Testnet Issues](#5-stellar-testnet-issues)
6. [Paystack Webhook Issues](#6-paystack-webhook-issues)
7. [Stripe Webhook Issues](#7-stripe-webhook-issues)
8. [Next.js / Application Issues](#8-nextjs--application-issues)
9. [Playwright E2E Test Issues](#9-playwright-e2e-test-issues)
10. [OTP / SMS Issues](#10-otp--sms-issues)
11. [Soroban Contract Issues](#11-soroban-contract-issues)
12. [Full Environment Reset](#12-full-environment-reset)

---

## 1. Docker and Container Issues

### Containers won't start

**Symptoms:**
```
Error response from daemon: Ports are not available: listen tcp 0.0.0.0:5432
```
or
```
Error response from daemon: driver failed programming external connectivity
```

**Diagnosis:**
```bash
# Check what's using the conflicting port
lsof -i :5432      # PostgreSQL port
lsof -i :6379      # Redis port
lsof -i :3000      # Next.js port

# Check existing containers (including stopped ones)
docker ps -a
```

**Resolution:**
```bash
# Stop the conflicting process or container
docker stop <container-name>

# Or kill the process on the port
lsof -ti:5432 | xargs kill -9
```

---

### `docker compose up` hangs or times out

**Diagnosis:**
```bash
# View logs from all services
docker compose logs -f

# Check individual service
docker compose logs -f app
docker compose logs -f postgres
docker compose logs -f redis
```

**Resolution:**
```bash
# Rebuild images (clears stale build cache)
docker compose up --build

# If the app container keeps restarting, check logs for the startup error
docker compose logs app | tail -50
```

---

### Container builds successfully but app crashes on start

**Diagnosis:**
```bash
docker compose logs app 2>&1 | grep -E "(Error|error|MISSING|failed)"
```

Most startup crashes are environment variable validation failures.  
See [Section 4 — Environment Variable Errors](#4-environment-variable-errors).

---

### ⚠️ DESTRUCTIVE: Full Docker reset

Only run this if you need to reset all containers and volumes (deletes all database data):

```bash
# ⚠️ DESTRUCTIVE — deletes all PostgreSQL data, Redis data, and images
docker compose down -v --rmi local
docker compose up --build
```

---

## 2. Database (PostgreSQL) Issues

### `ECONNREFUSED` on `localhost:5432`

**Symptoms:**
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Diagnosis:**
```bash
# Check if Postgres is running
docker ps | grep postgres
pg_isready -h localhost -p 5432 -U lumigift

# View Postgres logs
docker compose logs postgres
# or
docker logs lumigift-postgres
```

**Resolution:**
```bash
# Start the container if stopped
docker compose up -d postgres
# or (standalone container)
docker start lumigift-postgres
```

---

### `role "lumigift" does not exist` / `database "lumigift" does not exist`

**Diagnosis:**
```bash
psql -h localhost -p 5432 -U postgres -c '\l'    # list databases
psql -h localhost -p 5432 -U postgres -c '\du'   # list roles
```

**Resolution:**
```bash
# Create role and database manually
psql -h localhost -p 5432 -U postgres -c "CREATE USER lumigift WITH PASSWORD 'lumigift';"
psql -h localhost -p 5432 -U postgres -c "CREATE DATABASE lumigift OWNER lumigift;"
```

Then re-run migrations (see below).

---

### Migrations not applied / column does not exist errors

**Symptoms:**
```
error: column "stellar_tx_hash" does not exist
error: relation "gifts" does not exist
```

**Diagnosis:**
```bash
# Check which migrations have been applied (if you have a migrations table)
psql "$DATABASE_URL" -c "SELECT filename FROM schema_migrations ORDER BY applied_at;"
```

**Resolution — apply all migrations in order:**
```bash
for f in $(ls migrations/*.sql | sort); do
  echo "Applying $f..."
  psql "$DATABASE_URL" -f "$f"
done
```

**Verify:**
```bash
psql "$DATABASE_URL" -c "\d gifts"    # show gifts table columns
```

---

### ⚠️ DESTRUCTIVE: Drop and recreate the database

Only run this if migrations are conflicted and you need a clean slate (deletes all local data):

```bash
# ⚠️ DESTRUCTIVE — drops and recreates the lumigift database
psql -h localhost -p 5432 -U postgres -c "DROP DATABASE IF EXISTS lumigift;"
psql -h localhost -p 5432 -U postgres -c "CREATE DATABASE lumigift OWNER lumigift;"

# Re-apply all migrations
for f in $(ls migrations/*.sql | sort); do
  psql "$DATABASE_URL" -f "$f"
done
```

---

## 3. Redis Issues

### `ECONNREFUSED` on `localhost:6379`

**Diagnosis:**
```bash
docker ps | grep redis
redis-cli -h localhost -p 6379 ping    # should print PONG
```

**Resolution:**
```bash
# Start Redis via Docker Compose
docker compose up -d redis

# Verify it's running
redis-cli ping    # → PONG
```

---

### OTP not found in Redis / `Invalid OTP` in local testing

In local development, OTPs are delivered via Termii SMS. If you haven't configured Termii (or want to skip SMS), read the OTP directly from Redis:

```bash
# Replace with the phone number in E.164 format
redis-cli get "otp:+2348012345678"
```

The OTP is stored for 10 minutes. If the key is missing, the OTP has expired or was never stored — check Termii configuration.

---

### Session not persisting / users logged out immediately

Sessions are stored in Redis. Check that Redis is running and that `REDIS_URL` in `.env.local` points to it:

```bash
redis-cli -u "$REDIS_URL" ping    # → PONG

# List session keys
redis-cli -u "$REDIS_URL" keys "session:*"
```

---

### ⚠️ DESTRUCTIVE: Flush all Redis data

```bash
# ⚠️ DESTRUCTIVE — clears ALL Redis data including sessions and OTPs
redis-cli -u "$REDIS_URL" flushall
```

---

## 4. Environment Variable Errors

### App crashes at startup with missing variable errors

**Symptoms:**
```
Environment variable validation failed:

Missing required variables:
  - NEXTAUTH_SECRET
  - STELLAR_ESCROW_CONTRACT_ID
  - DATABASE_URL
```

**Diagnosis:**
```bash
# Check your .env.local file exists and has the expected variables
cat .env.local | grep -v '^#' | grep -v '^$'

# Confirm it is being picked up
grep 'NEXTAUTH_SECRET' .env.local
```

**Resolution:**
1. Copy the template if `.env.local` is missing: `cp .env.example .env.local`
2. Fill in all variables marked `[REQUIRED]` — see `docs/environment-variables.md`
3. Generate secrets where instructed: `openssl rand -base64 32`

---

### `NEXTAUTH_SECRET` is too short

**Symptom:**
```
NEXTAUTH_SECRET: String must contain at least 32 character(s)
```

**Resolution:**
```bash
# Generate a compliant secret and copy it into .env.local
openssl rand -base64 32
```

---

### `STELLAR_SERVER_SECRET_KEY` format invalid

**Symptom:**
```
STELLAR_SERVER_SECRET_KEY: Invalid (must start with S, 56 chars)
```

**Resolution:**  
Generate a valid testnet key:
```bash
stellar keys generate --global lumigift-dev --network testnet
stellar keys show lumigift-dev    # copy this value
```

---

### `DATABASE_URL` wrong format

**Symptom:**
```
DATABASE_URL: Invalid url
```

**Resolution:**  
The URL must follow the format:
```
postgresql://username:password@host:port/database
```
Example for local Docker: `postgresql://lumigift:lumigift@localhost:5432/lumigift`

---

## 5. Stellar Testnet Issues

### `op_no_trust` — USDC trustline missing

**Symptom:**
```
Stellar error: op_no_trust
```

Your server account hasn't established a trustline for USDC.

**Resolution:**
```bash
stellar tx new change-trust \
  --source-account lumigift-dev \
  --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --network testnet \
  --sign \
  --submit
```

---

### `tx_insufficient_balance` — account out of XLM

**Diagnosis:**
```bash
stellar account show lumigift-dev --network testnet
# Look for "native" (XLM) balance
```

**Resolution:**
```bash
# Re-fund with Friendbot (free testnet faucet)
stellar keys fund lumigift-dev --network testnet

# Or via HTTP
curl "https://friendbot.stellar.org/?addr=$(stellar keys address lumigift-dev)"
```

---

### Contract ID not found / `STELLAR_ESCROW_CONTRACT_ID` stale

After a testnet reset, previously deployed contracts no longer exist.

**Resolution:**
```bash
# Redeploy the contract
STELLAR_NETWORK=testnet npm run contract:deploy

# Copy the printed contract ID into .env.local
# STELLAR_ESCROW_CONTRACT_ID=C<new-id>
```

---

### Soroban RPC returns 503 / connection refused

**Diagnosis:**
```bash
curl -s https://soroban-testnet.stellar.org -I | head -5
# Look for HTTP/2 200 or 503
```

**Resolution:**  
This is a network-side issue. Check [status.stellar.org](https://status.stellar.org) for testnet outages.  
Transactions will queue locally and succeed once the network recovers.

---

### Clock skew causing transaction rejection

**Symptom:**
```
Stellar error: tx_bad_seq or tx_too_late
```

**Diagnosis:**
```bash
# Check system clock vs NTP
timedatectl status | grep "System clock"
date -u
```

**Resolution:**
```bash
# Sync system clock (Linux)
sudo timedatectl set-ntp true

# Or manually sync
sudo ntpdate -u pool.ntp.org
```

---

## 6. Paystack Webhook Issues

### Webhook not received locally

Paystack cannot reach `localhost`. Use a tunnel to expose your local server:

**Option A — ngrok (recommended):**
```bash
# Install ngrok: https://ngrok.com/download
ngrok http 3000

# Copy the https:// URL printed, e.g. https://abc123.ngrok.io
# Update NEXT_PUBLIC_APP_URL in .env.local to this URL
# Register https://abc123.ngrok.io/api/v1/payments as the Paystack webhook URL
```

**Option B — Vercel CLI tunnel:**
```bash
npx vercel dev
```

---

### `Invalid webhook signature` (401)

**Diagnosis:**
```bash
# Verify the secret matches what Paystack sends
grep PAYSTACK_SECRET_KEY .env.local
```

The server computes `HMAC-SHA512(PAYSTACK_SECRET_KEY, rawBody)` and compares it to the `x-paystack-signature` header. Ensure:
1. `PAYSTACK_SECRET_KEY` in `.env.local` matches the **Test Secret Key** in the Paystack dashboard.
2. The request body is read as raw bytes — not re-serialized JSON.

---

### Payment webhook received but gift status unchanged

**Diagnosis:**
```bash
# Check application logs for webhook processing errors
docker compose logs app | grep -E "(webhook|charge.success|giftId)"

# Check the gift status in the database
psql "$DATABASE_URL" -c "SELECT id, status, updated_at FROM gifts ORDER BY updated_at DESC LIMIT 10;"
```

Duplicate references are idempotent — the second webhook for the same `reference` is acknowledged silently. If the gift is still `pending_payment`, the first webhook likely failed.

---

## 7. Stripe Webhook Issues

### Webhook signature verification failed

**Diagnosis:**
```bash
grep STRIPE_WEBHOOK_SECRET .env.local
```

For local development use the Stripe CLI to forward events:

```bash
# Install Stripe CLI: https://stripe.com/docs/stripe-cli
stripe listen --forward-to localhost:3000/api/v1/payments/stripe/webhook

# The CLI prints a webhook signing secret — use this as STRIPE_WEBHOOK_SECRET in .env.local
# e.g.: whsec_test_abc123...
```

---

## 8. Next.js / Application Issues

### `Module not found` after pulling new changes

**Resolution:**
```bash
npm install
```

---

### Port 3000 already in use

```bash
# Find the PID
lsof -ti:3000

# Kill it
lsof -ti:3000 | xargs kill -9

# Restart
npm run dev
```

---

### `next: command not found`

```bash
# Run via npx
npx next dev

# Or reinstall node_modules
rm -rf node_modules && npm install
```

---

### TypeScript type errors on startup

```bash
# Run type check separately to get clean output
npm run type-check

# Common fix: regenerate Next.js types
npx next build --no-lint 2>&1 | head -30
```

---

### Hot reload not working in Docker

Ensure you're using the dev compose file, which mounts source files as a volume:

```bash
docker compose -f docker-compose.dev.yml up
```

The production `docker-compose.yml` bakes the source into the image — edits won't reflect without a rebuild.

---

### `INTERNAL_ERROR` responses for all API calls

**Diagnosis:**
Check server logs for the underlying error. The `correlationId` in the error response maps to the log entry:

```bash
docker compose logs app | grep "<correlationId-from-response>"
```

Common causes: database connection failure, missing environment variable not caught at startup, Redis unreachable.

---

## 9. Playwright E2E Test Issues

### `Error: browserType.launch: Executable doesn't exist`

**Resolution:**
```bash
npx playwright install chromium
```

---

### Tests fail with `net::ERR_CONNECTION_REFUSED`

The app is not running on port 3000. Start it before running Playwright:

```bash
npm run dev &
sleep 5
npx playwright test
```

Or configure `webServer` in `playwright.config.ts` (already configured — check that `npm run dev` starts cleanly).

---

### Visual regression tests failing after UI changes

Playwright visual tests compare screenshots to stored baselines. After intentional UI changes, update the snapshots:

```bash
npx playwright test --update-snapshots
```

Review the diff before committing updated snapshots — do not mass-accept changes without reviewing them.

---

### Test results left in `test-results/`

`test-results/` is git-ignored. Do not commit test artifacts.  
If a test run fails and leaves artifacts, they will not appear in `git status`.

---

## 10. OTP / SMS Issues

### OTP never arrives

**Diagnosis — check Redis:**
```bash
redis-cli get "otp:+2348012345678"
# Returns the OTP if it was generated; nil if it wasn't stored or has expired
```

**Diagnosis — check Termii API key:**
```bash
curl -s -X POST https://api.ng.termii.com/api/sms/send \
  -H "Content-Type: application/json" \
  -d '{"api_key":"<your-key>","to":"+2348012345678","from":"Lumigift","sms":"Test","type":"plain","channel":"generic"}'
```

A `"message":"Successfully Sent"` response confirms the key works.

**Common causes:**
- `TERMII_API_KEY` missing or incorrect in `.env.local`
- Termii free trial balance exhausted
- Phone number not in E.164 format (must start with `+`)

---

### Rate limit hit on OTP requests

**Symptom:** `429 Too Many Requests` when requesting OTPs in quick succession.

**Resolution:** Wait 10 minutes (per-phone limit) or 1 hour (per-IP limit).  
In automated tests, mock the OTP service instead of hitting the real Termii endpoint:

```ts
jest.mock("@/lib/sms", () => ({ sendSMS: jest.fn().mockResolvedValue({ success: true }) }));
```

---

## 11. Soroban Contract Issues

### `wasm32-unknown-unknown` target not installed

**Symptom:**
```
error[E0463]: can't find crate for `std`
```

**Resolution:**
```bash
rustup target add wasm32-unknown-unknown
```

---

### `stellar-cli` not found

**Resolution:**
```bash
cargo install --locked stellar-cli --features opt

# Verify
stellar --version
```

---

### Contract tests fail: `cargo test` errors

```bash
# Run tests directly to see full output
cd contracts/escrow
cargo test -- --nocapture 2>&1 | head -50
```

Ensure the `wasm32-unknown-unknown` target and Soroban SDK version match `rust-toolchain.toml`:
```bash
cat rust-toolchain.toml
rustup show
```

---

### Contract build produces empty WASM

**Diagnosis:**
```bash
npm run contract:build 2>&1 | tail -20
ls -la contracts/escrow/target/wasm32-unknown-unknown/release/*.wasm
```

**Resolution:**
```bash
# Clean and rebuild
cd contracts/escrow
cargo clean
cd ../..
npm run contract:build
```

---

## 12. Full Environment Reset

Run these steps in order only if you need to completely start over.

> ⚠️ **DESTRUCTIVE — all local database data, Redis data, and contract deployments will be lost.**

```bash
# 1. Stop and remove all containers and volumes (deletes PostgreSQL and Redis data)
docker compose down -v --rmi local

# 2. Remove node_modules and reinstall
rm -rf node_modules
npm install

# 3. Remove Rust build artifacts
cd contracts/escrow && cargo clean && cd ../..

# 4. Recreate environment file
cp .env.example .env.local
# → Edit .env.local and fill in all required values

# 5. Start services fresh
docker compose up -d postgres redis

# 6. Wait for Postgres to be ready
until pg_isready -h localhost -p 5432 -U lumigift; do sleep 1; done

# 7. Apply all migrations
for f in $(ls migrations/*.sql | sort); do
  echo "Applying $f..."
  psql "$DATABASE_URL" -f "$f"
done

# 8. Generate a new testnet Stellar account
stellar keys generate --global lumigift-dev --network testnet
stellar keys fund lumigift-dev --network testnet
# Add trustline for USDC
stellar tx new change-trust \
  --source-account lumigift-dev \
  --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --network testnet --sign --submit
# Copy keys into .env.local

# 9. Deploy the escrow contract and copy the contract ID
STELLAR_NETWORK=testnet npm run contract:deploy
# → copy printed contract ID into STELLAR_ESCROW_CONTRACT_ID in .env.local

# 10. Start the development server
npm run dev
```

---

## Quick Diagnostic Checklist

Run this when something is broken and you don't know where to start:

```bash
echo "=== Docker ===" && docker ps --format "{{.Names}}\t{{.Status}}"
echo "=== Redis ===" && redis-cli ping 2>/dev/null || echo "UNREACHABLE"
echo "=== Postgres ===" && pg_isready -h localhost -p 5432 -U lumigift 2>/dev/null || echo "UNREACHABLE"
echo "=== .env.local ===" && [ -f .env.local ] && echo "EXISTS" || echo "MISSING"
echo "=== Stellar ===" && stellar account show lumigift-dev --network testnet 2>/dev/null | grep "native" || echo "ACCOUNT NOT FOUND"
```

---

## Related Documents

- `docs/local-dev-setup.md` — full step-by-step setup guide
- `docs/environment-variables.md` — every variable, its format, and where to get it
- `docs/architecture/gift-lifecycle.md` — gift state machine
- `docs/ops/runbook.md` — production incident runbook
- `docs/ops/key-rotation.md` — rotating secrets
