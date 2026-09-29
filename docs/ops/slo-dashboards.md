# SLO Dashboards & Alert Thresholds

> **Issue #103** — Create SLO dashboards and alert thresholds  
> Acceptance criteria: alerts have owners and runbooks; thresholds avoid alert noise.

---

## Service Level Objectives (SLOs)

Lumigift defines the following SLOs for the production environment. Each SLO has an
associated **error budget** — if the budget is exhausted, work stops and reliability
is restored before new features ship.

| SLO                     | Target     | Measurement window | Error budget (30 days) |
| ----------------------- | ---------- | ------------------ | ---------------------- |
| API availability        | 99.5 %     | Rolling 30 days    | 3.6 hours downtime     |
| P95 API latency         | ≤ 2 000 ms | Rolling 7 days     | —                      |
| P99 API latency         | ≤ 5 000 ms | Rolling 7 days     | —                      |
| Payment success rate    | 99.0 %     | Rolling 7 days     | 1 % of payments        |
| Gift claim success rate | 99.0 %     | Rolling 7 days     | 1 % of claim attempts  |
| Cron scheduler lag      | ≤ 2 min    | Rolling 1 day      | —                      |
| Health endpoint         | 99.9 %     | Rolling 30 days    | 43 minutes downtime    |

---

## Dashboards

### 1. API Health Dashboard

**Tool**: Betterstack (or Datadog / Grafana Cloud)  
**Purpose**: Real-time visibility into request volume, error rates, and latency.

#### Panels

| Panel                   | Query / metric                                        | Chart type |
| ----------------------- | ----------------------------------------------------- | ---------- |
| Request rate            | Count of log lines per minute (`level = "info"`)      | Line       |
| Error rate (%)          | `count(level="error") / count(all) * 100`             | Line       |
| P50 / P95 / P99 latency | `responseTime` field from pino-http (percentiles)     | Line       |
| 4xx rate                | Count of log lines with `statusCode >= 400 && < 500`  | Line       |
| 5xx rate                | Count of log lines with `statusCode >= 500`           | Line       |
| Active DB connections   | Vercel function metric or pino log field `dbPoolSize` | Gauge      |
| Redis ping latency      | Log field `redisPingMs` from health check             | Gauge      |

#### SLO Indicator Widgets

Add burn-rate widgets for:

- **Availability**: `1 - (5xx_count / total_requests)` — alert at 99 % burn threshold.
- **Latency**: Rolling P95 — alert when > 2 000 ms for 5+ consecutive minutes.

---

### 2. Payment & Gift Flow Dashboard

**Purpose**: End-to-end visibility into the payment and gift lifecycle.

#### Panels

| Panel                         | Query                                                     | Chart type |
| ----------------------------- | --------------------------------------------------------- | ---------- |
| Paystack payments initiated   | `service = "paystack"` + `msg LIKE "%payment%initiated%"` | Counter    |
| Paystack payments succeeded   | `service = "paystack"` + `msg LIKE "%charge.success%"`    | Counter    |
| Paystack payment failure rate | `failures / initiated * 100`                              | Line       |
| Stripe payments initiated     | `service = "stripe"` + `msg LIKE "%payment%initiated%"`   | Counter    |
| Stripe payment failure rate   | —                                                         | Line       |
| Gift claims attempted         | `service = "claim"` + `msg LIKE "%claim%attempt%"`        | Counter    |
| Gift claim success rate       | `claims_ok / claims_attempted * 100`                      | Line       |
| Dead-lettered gifts           | Reconcile cron response field `deadLetteredTotal`         | Gauge      |
| Gifts stuck in `locked` > 1h  | DB query: `status='locked' AND unlock_time < NOW()-1h`    | Gauge      |

---

### 3. Cron Scheduler Dashboard

**Purpose**: Confirm all scheduled jobs are running on time and completing successfully.

#### Panels

| Panel                               | Source                                             | Chart type |
| ----------------------------------- | -------------------------------------------------- | ---------- |
| Unlock cron — last run time         | Healthchecks.io check status                       | Status     |
| Unlock cron — duration (ms)         | Log field `durationMs`                             | Line       |
| Index-events cron — last run        | Healthchecks.io check status                       | Status     |
| Reconcile cron — last run           | Healthchecks.io check status                       | Status     |
| Expire cron — last run              | Healthchecks.io check status                       | Status     |
| Cron errors (last 24h)              | Log lines matching `cron.*failed`                  | Counter    |
| Scheduler lag (gifts unlocked late) | DB: `unlock_time < NOW()-2min AND status='locked'` | Gauge      |

---

### 4. Dependency Availability Dashboard

**Purpose**: Track availability of PostgreSQL, Redis, Stellar, and Paystack.

#### Panels

| Panel                  | Source                                                                   | Chart type |
| ---------------------- | ------------------------------------------------------------------------ | ---------- |
| DB health              | `/api/health` response `checks.db`                                       | Status     |
| Redis health           | `/api/health` response `checks.redis`                                    | Status     |
| Horizon health         | `/api/health` response `checks.horizon`                                  | Status     |
| Health endpoint uptime | Uptime monitor on `/api/health`                                          | % uptime   |
| External API errors    | Log lines `service IN ("paystack","termii","stellar")` + `level="error"` | Line       |

---

## Alert Thresholds

Thresholds are set to avoid alert fatigue — alert only when the condition is sustained,
not on a single spike.

### Availability Alerts

| Alert                 | Condition                                  | Duration | Severity | Owner            | Runbook link                                                                 |
| --------------------- | ------------------------------------------ | -------- | -------- | ---------------- | ---------------------------------------------------------------------------- |
| High 5xx error rate   | `5xx_rate > 1 %`                           | 5 min    | P1       | On-call engineer | [runbook.md § Performance](./runbook.md#application-performance-degradation) |
| 5xx spike             | `5xx_rate > 5 %`                           | 2 min    | P0       | On-call engineer | [runbook.md § Performance](./runbook.md#application-performance-degradation) |
| Health endpoint down  | `/api/health` returns non-200 or times out | 2 checks | P0       | On-call engineer | [runbook.md § Database](./runbook.md#database-connection-failure)            |
| SLO availability burn | Error budget > 50 % consumed in 1 hour     | —        | P1       | Engineering lead | [runbook.md](./runbook.md)                                                   |

### Latency Alerts

| Alert                | Condition                       | Duration | Severity | Owner            |
| -------------------- | ------------------------------- | -------- | -------- | ---------------- |
| P95 latency elevated | `p95(responseTime) > 2 000 ms`  | 5 min    | P2       | On-call engineer |
| P95 latency critical | `p95(responseTime) > 5 000 ms`  | 3 min    | P1       | On-call engineer |
| P99 latency critical | `p99(responseTime) > 10 000 ms` | 2 min    | P0       | On-call engineer |

### Payment Alerts

| Alert                   | Condition                                                    | Duration | Severity | Owner       |
| ----------------------- | ------------------------------------------------------------ | -------- | -------- | ----------- |
| Paystack failure spike  | `service="paystack"` errors > 3 in 5 min                     | —        | P1       | Engineering |
| Stripe webhook failures | `service="stripe"` webhook errors > 2 in 5 min               | —        | P1       | Engineering |
| Dead-lettered gifts     | `deadLetteredTotal > 5`                                      | —        | P1       | Engineering |
| Gifts unlocked late     | Any gift with `unlock_time < NOW()-5min` + `status='locked'` | —        | P1       | On-call     |

### Cron / Scheduler Alerts

| Alert                    | Condition                         | Severity | Owner            | Runbook link                                            |
| ------------------------ | --------------------------------- | -------- | ---------------- | ------------------------------------------------------- |
| Unlock cron missed       | No ping in > 2 min (grace 2 min)  | P0       | On-call engineer | [cron-monitoring.md](./cron-monitoring.md#escalation)   |
| Index-events cron missed | No ping in > 10 min (grace 5 min) | P0       | On-call engineer | [cron-monitoring.md](./cron-monitoring.md)              |
| Reconcile cron missed    | No ping in > 7 hours (grace 1 h)  | P1       | Engineering lead | [cron-monitoring.md](./cron-monitoring.md)              |
| Expire cron missed       | No ping in > 26 hours (grace 2 h) | P1       | Engineering lead | [cron-monitoring.md](./cron-monitoring.md)              |
| Cron unauthorized (401)  | Any cron endpoint returns 401     | P2       | Security team    | [runbook.md § Security](./runbook.md#security-incident) |

### Dependency Alerts

| Alert                     | Condition                            | Severity | Owner   | Runbook link                                                      |
| ------------------------- | ------------------------------------ | -------- | ------- | ----------------------------------------------------------------- |
| DB unhealthy              | `checks.db = "error"` in health      | P0       | On-call | [runbook.md § Database](./runbook.md#database-connection-failure) |
| Redis unhealthy           | `checks.redis = "error"` in health   | P0       | On-call | [runbook.md § Redis](./runbook.md#redis-outage)                   |
| Horizon/Stellar unhealthy | `checks.horizon = "error"` in health | P1       | On-call | [runbook.md § Stellar](./runbook.md#stellar-network-degradation)  |

---

## Noise-Reduction Guidelines

To avoid alert fatigue:

1. **No single-sample alerts** — all thresholds require sustained violation (minimum 2–5 minutes).
2. **Daytime vs. overnight severity** — P2 alerts do not page outside business hours; they create Slack tickets only.
3. **Alert deduplication** — group related alerts (e.g. DB down → all 5xx alerts suppressed since root cause is known).
4. **Test alert routing monthly** — fire a test alert for each P0 channel to confirm delivery.
5. **Review thresholds quarterly** — adjust based on actual baseline metrics to avoid drifting thresholds.

---

## Dashboard Setup Instructions

### Betterstack (recommended)

1. Go to **Telemetry** → **Dashboards** → **New Dashboard**.
2. Add a **Logs** tile for each panel listed above, using the Betterstack log query syntax.
3. For SLO burn-rate tiles, use the **Metrics** tile with the formula `1 - (errors / total)`.
4. Set the time range to **rolling 7 days** for payment/claim panels and **rolling 30 days** for availability.
5. Share the dashboard link with the team and pin it to Slack `#ops`.

### Uptime Monitoring

Configure monitors in Betterstack (or UptimeRobot / PingPong):

| URL                               | Check interval | Alert threshold        |
| --------------------------------- | -------------- | ---------------------- |
| `https://lumigift.app/api/health` | 1 minute       | 2 consecutive failures |
| `https://lumigift.app/`           | 5 minutes      | 2 consecutive failures |

---

## Error Budget Policy

When an SLO's error budget is > 50 % consumed within a rolling 7-day window:

1. Engineering lead is notified automatically (Betterstack SLO burn-rate alert).
2. A reliability review is scheduled within 24 hours.
3. New feature work is paused until the budget is restored below 25 %.

When the budget is 100 % exhausted:

1. P0 incident declared immediately.
2. On-call engineer and CTO are paged.
3. Post-mortem required within 48 hours.

---

## Related Documents

- [`docs/ops/runbook.md`](./runbook.md) — Incident response and resolution playbooks
- [`docs/ops/cron-monitoring.md`](./cron-monitoring.md) — Cron job monitoring setup
- [`docs/ops/log-retention-policy.md`](./log-retention-policy.md) — Log fields, retention, redaction
- [`docs/ops/uptime-monitoring.md`](./uptime-monitoring.md) — Uptime monitor configuration
