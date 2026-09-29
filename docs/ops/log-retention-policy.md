# Log Retention Policy

> **Issue #102** — Add centralized structured log retention policy  
> Acceptance criteria: PII and credentials are redacted; retention meets policy.

---

## Overview

All application logs are emitted as **structured JSON** via [pino](https://github.com/pinojs/pino)
to `stdout`. In production the log stream is shipped to **Logtail / Betterstack** (or a
compatible provider) via the `LOG_AGGREGATION_URL` and `LOG_AGGREGATION_TOKEN`
environment variables.

This document defines what is logged, how long it is retained, what is redacted, and
who may access logs.

---

## Log Levels

| Level   | Use                                                         | Production default |
| ------- | ----------------------------------------------------------- | ------------------ |
| `fatal` | Application cannot continue; immediate action required      | ✅ emitted         |
| `error` | Recoverable error requiring investigation                   | ✅ emitted         |
| `warn`  | Unexpected but non-fatal condition                          | ✅ emitted         |
| `info`  | Normal operational events (request in/out, cron runs, etc.) | ✅ emitted         |
| `debug` | Detailed diagnostic information                             | ❌ suppressed      |
| `trace` | Very low-level diagnostic information                       | ❌ suppressed      |

Set `LOG_LEVEL=debug` only in development or during an active incident investigation.
Never enable `trace` in production.

---

## Standard Log Fields

Every log line includes these base fields:

| Field           | Type   | Description                                       |
| --------------- | ------ | ------------------------------------------------- |
| `level`         | string | Log level (`info`, `error`, etc.)                 |
| `time`          | string | ISO 8601 timestamp (UTC)                          |
| `env`           | string | `NODE_ENV` value                                  |
| `app`           | string | Always `lumigift`                                 |
| `service`       | string | Emitting service/module (e.g. `auth`, `paystack`) |
| `correlationId` | string | UUID identifying the request chain                |
| `msg`           | string | Human-readable log message                        |

Additional context fields are included per log call (e.g. `giftId`, `userId`,
`durationMs`, `statusCode`).

---

## Redacted Fields

The following fields are **automatically redacted** by the pino logger before any log
line is written to stdout or shipped to the aggregation service. They are replaced with
the literal string `[REDACTED]`.

### PII (Personal Identifiable Information)

| Field path(s)        | Reason                            |
| -------------------- | --------------------------------- |
| `phone`              | User phone number                 |
| `recipientPhone`     | Recipient phone number            |
| `recipientPhoneHash` | Hashed phone (still PII-adjacent) |
| `*.phone`            | Nested phone fields               |
| `*.recipientPhone`   | Nested recipient phone fields     |
| `req.headers.cookie` | Session cookie                    |

### Credentials & Secrets

| Field path(s)               | Reason                        |
| --------------------------- | ----------------------------- |
| `req.headers.authorization` | Bearer tokens                 |
| `*.token`                   | Any nested `token` field      |
| `*.secret`                  | Any nested `secret` field     |
| `*.apiKey`                  | Any nested `apiKey` field     |
| `*.privateKey`              | Any nested `privateKey` field |
| `*.password`                | Any nested `password` field   |
| `*.paystackSignature`       | Webhook HMAC signature        |

> **Logging checklist for developers**: Before adding a new log call, verify it does
> not include raw phone numbers, payment card data, auth tokens, Stellar private keys,
> OTP codes, or any NDPR/GDPR-regulated data. If a new sensitive field pattern is
> identified, update the `redact.paths` array in `src/lib/logger.ts` and this document.

---

## Retention Policy

| Log type           | Retention   | Provider setting                                           |
| ------------------ | ----------- | ---------------------------------------------------------- |
| Application logs   | **30 days** | Betterstack: Sources → your source → Retention → 30 days   |
| Audit logs         | **90 days** | Separate Betterstack source or database table `audit_logs` |
| Security/auth logs | **90 days** | Separate Betterstack source, filter `service = "auth"`     |
| Error logs         | **30 days** | Included in application logs; export P0 incidents to S3    |

Logs **must not** be retained beyond these periods except for active incident investigations
(freeze the relevant window in your aggregation service) or legal holds (contact legal@lumigift.app).

---

## Log Sources

### Application Logs (pino → stdout → Logtail)

Shipped via the Logtail pino transport or HTTP ingestion:

```
LOG_AGGREGATION_URL=https://in.logs.betterstack.com
LOG_AGGREGATION_TOKEN=<source-token>
LOG_LEVEL=info
```

In production (Vercel), stdout is automatically captured. Configure the Betterstack
**Vercel integration** or set the above env vars to enable HTTP shipping.

### Audit Logs (database)

High-value operations (payment, claim, cancel, role change) are written to the
`audit_logs` PostgreSQL table by `src/server/services/audit.service.ts`. These are
queried via `GET /api/v1/admin/audit-logs` (admin-only).

Retention: the `audit_logs` table should be pruned by a scheduled job after 90 days:

```sql
-- Run monthly (or add to a migration):
DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days';
```

### Vercel Function Logs

Available in the Vercel dashboard (Project → Logs) with a 1-day rolling window in the
free tier and up to 30 days on Pro. Export to Betterstack for longer retention.

---

## Access Control

| Role             | Access                                                  |
| ---------------- | ------------------------------------------------------- |
| On-call engineer | Full read access to all log sources                     |
| Developer        | Read access to application logs; no audit log write     |
| Admin            | Full access including audit log queries                 |
| External auditor | Temporary read-only export; granted by engineering lead |

Access to the Betterstack dashboard is managed via SSO (Google Workspace).
Service accounts use API tokens stored in 1Password (Ops vault).

Do **not** share raw log exports containing unredacted data externally. If PII slips
through redaction, treat it as a data incident and notify the data protection officer.

---

## Alert Rules

Configure the following in Betterstack (or equivalent):

| Alert            | Condition                                                        | Channel                     |
| ---------------- | ---------------------------------------------------------------- | --------------------------- |
| High error rate  | `level = "error"` count > 10 in 5 min                            | Slack #incidents            |
| Auth failures    | `service = "auth"` + `level = "error"` > 5 in 1 min              | Slack #incidents            |
| Payment failures | `service = "paystack"` + `level = "error"` > 3 in 5 min          | Slack #incidents            |
| PII leak risk    | Any line containing `recipientPhone` or `phone` not `[REDACTED]` | Slack #security + PagerDuty |

---

## Related Documents

- [`docs/ops/runbook.md`](./runbook.md) — Incident response procedures
- [`docs/ops/cron-monitoring.md`](./cron-monitoring.md) — Cron job alerts
- [`docs/ops/slo-dashboards.md`](./slo-dashboards.md) — SLO thresholds and dashboards
- [`src/lib/logger.ts`](../../src/lib/logger.ts) — Logger implementation and redact config
- [`src/server/services/audit.service.ts`](../../src/server/services/audit.service.ts) — Audit log writes
