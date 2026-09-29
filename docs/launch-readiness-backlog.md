# Launch Readiness Backlog

> **Issue #156** — Prioritized checklist of operational, legal, support, payment, and contract gates
> that must be cleared before Lumigift goes to production mainnet.
>
> Each gate lists its owner, evidence/doc link, and current status.

---

## How to Use This Document

- Work through items from **CRITICAL → HIGH → MEDIUM → LOW**.
- Update the `Status` column as items are completed:
  - `[ ]` — not started
  - `[~]` — in progress
  - `[x]` — done / evidence linked

---

## CRITICAL Blockers

These must be resolved before any real-money transaction is processed.

| # | Gate | Owner | Evidence / Doc | Status |
|---|------|-------|---------------|--------|
| C-1 | **Smart contract security audit** (Soroban escrow) by a third party | Engineering | [contracts/escrow/README.md](../contracts/escrow/README.md) | `[ ]` |
| C-2 | **Threat model reviewed and signed off** by security lead | Security | [SECURITY_IMPROVEMENTS.md](../SECURITY_IMPROVEMENTS.md) | `[ ]` |
| C-3 | **Mainnet escrow contract deployed** and `.contract-ids.json` updated | Engineering | [.contract-ids.json](../.contract-ids.json), [scripts/deploy-contract.ts](../scripts/deploy-contract.ts) | `[ ]` |
| C-4 | **Private key management** — all hot-wallet keys in secrets manager (never in `.env` on prod) | DevOps | [docs/ops/key-rotation.md](ops/key-rotation.md) | `[ ]` |
| C-5 | **Database backups verified** with at least one successful restore drill | DevOps | [docs/ops/database-backup.md](ops/database-backup.md) | `[ ]` |
| C-6 | **NGN → USDC exchange-rate feed live** on mainnet with circuit-breaker | Engineering | [src/server/services/exchange-rate.service.ts](../src/server/services/exchange-rate.service.ts) | `[ ]` |
| C-7 | **Paystack live (production) API keys** configured in production secrets | Payments | [docs/adr/0002-payment-provider-paystack.md](adr/0002-payment-provider-paystack.md) | `[ ]` |
| C-8 | **Paystack webhook HMAC signature verification** confirmed active in production | Payments | [src/app/api/v1/payments/](../src/app/api/v1/) | `[ ]` |
| C-9 | **SQL injection audit passed** — no raw string interpolation in production queries | Engineering | [docs/audit/sql-injection-audit.md](audit/sql-injection-audit.md) | `[ ]` |
| C-10 | **CSRF protection verified** end-to-end on all mutating endpoints | Engineering | [src/lib/csrf.ts](../src/lib/csrf.ts) | `[ ]` |

---

## HIGH Priority Gates

Complete before launch day. Non-negotiable for production traffic.

| # | Gate | Owner | Evidence / Doc | Status |
|---|------|-------|---------------|--------|
| H-1 | **Legal T&Cs and Privacy Policy** live at `/terms` and `/privacy` | Legal | [TERMS.md](../TERMS.md) | `[ ]` |
| H-2 | **NDPR (Nigerian Data Protection Regulation) compliance** review | Legal | [SECURITY.md](../SECURITY.md) | `[ ]` |
| H-3 | **Runbook reviewed and signed off** by on-call team | DevOps | [docs/ops/runbook.md](ops/runbook.md) | `[ ]` |
| H-4 | **On-call rotation established** (PagerDuty or equivalent) with escalation paths | DevOps | [docs/ops/runbook.md](ops/runbook.md) | `[ ]` |
| H-5 | **Redis failure policy tested** in staging | Engineering | [docs/ops/redis-failure-policy.md](ops/redis-failure-policy.md) | `[ ]` |
| H-6 | **Cron job monitoring** (unlock scheduler) with alerts for missed runs | DevOps | [docs/ops/cron-monitoring.md](ops/cron-monitoring.md) | `[ ]` |
| H-7 | **SLO dashboards configured** with alerting thresholds | DevOps | [docs/ops/slo-dashboards.md](ops/slo-dashboards.md) | `[ ]` |
| H-8 | **Stripe webhook endpoint** registered and live secret set in production | Payments | [src/app/api/v1/payments/](../src/app/api/v1/) | `[ ]` |
| H-9 | **Stellar testnet → mainnet migration** complete (network env vars, contract IDs) | Engineering | [docs/ops/contract-migration.md](ops/contract-migration.md) | `[ ]` |
| H-10 | **Uptime monitoring** (Uptime Robot / Better Uptime) with status page | DevOps | [docs/ops/uptime-monitoring.md](ops/uptime-monitoring.md) | `[ ]` |
| H-11 | **Rate limiting** validated under load test conditions | Engineering | [docs/performance/load-test-results.md](performance/load-test-results.md) | `[ ]` |
| H-12 | **Phone number hashing** migration applied on production DB | Engineering | [migrations/0003_hash_recipient_phone.sql](../migrations/0003_hash_recipient_phone.sql) | `[ ]` |

---

## MEDIUM Priority Gates

Complete within one week of launch.

| # | Gate | Owner | Evidence / Doc | Status |
|---|------|-------|---------------|--------|
| M-1 | **FAQ and Help Center** live and accessible | Product | [src/app/faq/](../src/app/faq/), [src/app/help/](../src/app/help/) | `[ ]` |
| M-2 | **Contact/support email** (`support@lumigift.com`) routing to helpdesk | Support | — | `[ ]` |
| M-3 | **Incident response plan** documented and shared with team | DevOps | [docs/ops/runbook.md](ops/runbook.md) | `[ ]` |
| M-4 | **Accessibility audit** (WCAG 2.1 AA) completed with violations tracked | Engineering | [docs/accessibility/known-violations.md](accessibility/known-violations.md), [docs/accessibility/a11y-localization-requirements.md](accessibility/a11y-localization-requirements.md) | `[ ]` |
| M-5 | **Log retention policy** configured in production | DevOps | [docs/ops/log-retention-policy.md](ops/log-retention-policy.md) | `[ ]` |
| M-6 | **Key rotation runbook** tested with simulated key rotation | DevOps | [docs/ops/key-rotation.md](ops/key-rotation.md), [docs/ops/key-rotation-log.md](ops/key-rotation-log.md) | `[ ]` |
| M-7 | **Audit log table** (`audit_logs`) confirmed active in production | Engineering | [migrations/0005_audit_logs.sql](../migrations/0005_audit_logs.sql) | `[ ]` |
| M-8 | **User roles migration** applied and `admin` role gated endpoints verified | Engineering | [migrations/0006_add_user_roles.sql](../migrations/0006_add_user_roles.sql) | `[ ]` |
| M-9 | **OpenAPI spec** matches production routes (validated in CI) | Engineering | [openapi.yaml](../openapi.yaml), [.github/workflows/openapi-validate.yml](../.github/workflows/openapi-validate.yml) | `[ ]` |
| M-10 | **Smoke test suite** passing against staging environment | QA | [scripts/smoke-test.sh](../scripts/smoke-test.sh) | `[ ]` |

---

## LOW Priority Gates

Complete within one month of launch.

| # | Gate | Owner | Evidence / Doc | Status |
|---|------|-------|---------------|--------|
| L-1 | **User notification center** live (in-app notifications with read state) | Engineering | [Issue #153](https://github.com/joekeyz8/Lumigift-lumigift/issues/153) | `[ ]` |
| L-2 | **Contract event indexer** tested on mainnet for gift lifecycle events | Engineering | [docs/contract-events.md](../docs/contract-events.md) | `[ ]` |
| L-3 | **Payment reconciliation job** tested with real Paystack webhooks | Engineering | [src/server/services/payment-reconciliation.service.ts](../src/server/services/payment-reconciliation.service.ts) | `[ ]` |
| L-4 | **Gift invitation flow** end-to-end tested in staging | QA | [migrations/0004_gift_invitations.sql](../migrations/0004_gift_invitations.sql) | `[ ]` |
| L-5 | **Localization requirements** satisfied for Nigerian languages | Product | [docs/accessibility/a11y-localization-requirements.md](accessibility/a11y-localization-requirements.md) | `[ ]` |
| L-6 | **Sentry error tracking** configured for production with alert thresholds | DevOps | [sentry.server.config.ts](../sentry.server.config.ts) | `[ ]` |
| L-7 | **Terraform infrastructure** reviewed and locked at pinned module versions | DevOps | [infra/terraform/main.tf](../infra/terraform/main.tf) | `[ ]` |
| L-8 | **Contract benchmarks** reviewed; no regressions from last baseline | Engineering | [contracts/escrow/BENCHMARKS.md](../contracts/escrow/BENCHMARKS.md) | `[ ]` |

---

## Completion Tracking

| Priority | Total | Done | Remaining |
|----------|-------|------|-----------|
| CRITICAL | 10 | 0 | 10 |
| HIGH | 12 | 0 | 12 |
| MEDIUM | 10 | 0 | 10 |
| LOW | 8 | 0 | 8 |
| **Total** | **40** | **0** | **40** |

---

*Last updated: 2026-09-29. Owner: Product / Engineering.*
