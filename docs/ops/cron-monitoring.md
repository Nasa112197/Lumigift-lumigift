# Cron Job Monitoring & Missing-Call Alerts

> **Issue #101** — Configure scheduled cron invocation in production  
> Acceptance criteria: schedules run at intended cadence; missing or unauthorized calls alert operators.

---

## Cron Schedule Overview

All cron jobs are invoked by **Vercel Cron** (configured in `vercel.json`) and protected
by the `CRON_SECRET` bearer token. Each job also pings a dead-man's-switch URL so that
_silence_ (a missed invocation) is just as detectable as an explicit failure.

| Route                           | Cadence            | Purpose                                            | Healthcheck env var            |
| ------------------------------- | ------------------ | -------------------------------------------------- | ------------------------------ |
| `GET /api/v1/cron/unlock`       | Every minute       | Unlock gifts whose `unlock_time` has passed        | `HEALTHCHECK_URL`              |
| `GET /api/v1/cron/index-events` | Every 5 min        | Index Soroban escrow events, sync gift status      | `HEALTHCHECK_URL_INDEX_EVENTS` |
| `GET /api/v1/cron/reconcile`    | Every 6 hours      | Reconcile Paystack payments, surface dead-letters  | `HEALTHCHECK_URL_RECONCILE`    |
| `GET /api/v1/cron/expire`       | Daily at 02:00 UTC | Expire unclaimed gifts (> 365 days), refund sender | `HEALTHCHECK_URL_EXPIRE`       |

---

## Authentication

Every cron route checks:

```
Authorization: Bearer <CRON_SECRET>
```

Vercel automatically injects this header when invoking cron functions — set `CRON_SECRET`
as an environment variable in the Vercel project dashboard (production **and** staging).

A missing or incorrect token returns `401 Unauthorized`. If you see 401s in cron logs,
the `CRON_SECRET` env var is not set correctly in the Vercel environment.

---

## Dead-Man's-Switch Setup (Healthchecks.io)

Each cron job pings a unique URL on success. If the ping is not received within the
expected period, Healthchecks.io (or your chosen provider) fires an alert.

### Step-by-step (Healthchecks.io)

1. Go to [https://healthchecks.io](https://healthchecks.io) → **Create Check**.
2. Create one check per cron job with the period and grace matching the schedule:

   | Job          | Period    | Grace  |
   | ------------ | --------- | ------ |
   | unlock       | 1 minute  | 2 min  |
   | index-events | 5 minutes | 5 min  |
   | reconcile    | 6 hours   | 15 min |
   | expire       | 24 hours  | 30 min |

3. Copy each check's **ping URL** and set the corresponding environment variable in Vercel:

   ```
   HEALTHCHECK_URL=https://hc-ping.com/<uuid>          # unlock (fallback for all)
   HEALTHCHECK_URL_INDEX_EVENTS=https://hc-ping.com/<uuid>
   HEALTHCHECK_URL_RECONCILE=https://hc-ping.com/<uuid>
   HEALTHCHECK_URL_EXPIRE=https://hc-ping.com/<uuid>
   ```

4. For **failure pings** (job runs but throws an error), each route also calls
   `HEALTHCHECK_URL<suffix>/fail` — Healthchecks.io treats `/fail` pings as
   immediately failed regardless of grace period.

### Alternative: BetterUptime / Cronitor

Both support the same `/fail` suffix convention. The env var names are identical —
just swap the ping URL base.

---

## Alert Rules

Configure the following alerts in your monitoring provider:

### Vercel Cron Dashboard Alerts

In the Vercel dashboard (Project → Settings → Cron Jobs):

- Enable **email notifications** for cron job failures.
- Set the notification email to `ops@lumigift.app` (or your on-call alias).

### Healthchecks.io Alerts

For each check, configure:

- **Alert channel**: Slack `#incidents` + PagerDuty/email for P0 jobs (unlock, index-events).
- **Alert message template**:

  ```
  🔴 Cron job MISSED: {check_name}
  Last ping: {last_ping}
  Expected every: {period}
  Runbook: https://github.com/joekeyz8/Lumigift-lumigift/blob/main/docs/ops/runbook.md#cron-job-failure
  ```

### Log-Based Alerts (Betterstack / Logtail)

Create alerts on structured log fields:

| Alert                     | Query                                       | Threshold      | Channel          |
| ------------------------- | ------------------------------------------- | -------------- | ---------------- |
| Cron unlock failure       | `message LIKE '%cron/unlock%failed%'`       | ≥ 1 in 5 min   | Slack #incidents |
| Cron expire failure       | `message LIKE '%cron/expire%failed%'`       | ≥ 1 in 1 hour  | Slack #incidents |
| Cron reconcile failure    | `message LIKE '%cron/reconcile%failed%'`    | ≥ 1 in 6 hours | Slack #incidents |
| Cron index-events failure | `message LIKE '%cron/index-events%failed%'` | ≥ 1 in 15 min  | Slack #incidents |
| Unauthorized cron calls   | `message LIKE '%cron%' AND status = 401`    | ≥ 3 in 5 min   | Slack #security  |

---

## Manual Invocation (for testing or recovery)

You can trigger any cron job manually with:

```bash
# Unlock (replace BASE_URL and CRON_SECRET with real values)
curl -X GET "https://lumigift.app/api/v1/cron/unlock" \
  -H "Authorization: Bearer $CRON_SECRET"

# Expire
curl -X GET "https://lumigift.app/api/v1/cron/expire" \
  -H "Authorization: Bearer $CRON_SECRET"

# Reconcile
curl -X GET "https://lumigift.app/api/v1/cron/reconcile" \
  -H "Authorization: Bearer $CRON_SECRET"

# Index events
curl -X GET "https://lumigift.app/api/v1/cron/index-events" \
  -H "Authorization: Bearer $CRON_SECRET"
```

A successful response looks like:

```json
{ "success": true, "data": { "processed": 3, "durationMs": 142 } }
```

A `401` response means `CRON_SECRET` is wrong or not passed.

---

## Escalation

See the [Cron Job Failure section in the runbook](./runbook.md#cron-job-failure) for
full diagnosis and resolution steps.

| Severity | Condition                                       | Owner            |
| -------- | ----------------------------------------------- | ---------------- |
| P0       | `unlock` missed for > 5 minutes                 | On-call engineer |
| P0       | `index-events` missed for > 15 minutes          | On-call engineer |
| P1       | `reconcile` missed for > 12 hours               | Engineering lead |
| P1       | `expire` missed for > 48 hours                  | Engineering lead |
| P2       | Any cron 401 (unauthorized invocation attempts) | Security team    |
