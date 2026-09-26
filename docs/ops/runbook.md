# Production Incident Runbook

This runbook provides procedures for handling common production incidents in Lumigift. Each incident includes symptoms, diagnosis steps, resolution steps, and escalation paths.

## General Guidelines

- **Alert Channels**: Incidents are alerted via Vercel monitoring, DataDog, or manual reports
- **Response Times**:
  - P0 (Critical): <15 minutes
  - P1 (High): <1 hour
  - P2 (Medium): <4 hours
- **Communication**: Update stakeholders via Slack #incidents channel
- **Post-Mortem**: Conduct blameless post-mortem for all P0/P1 incidents

## Database Connection Failure

### Symptoms

- API endpoints return 500 errors with "database connection failed"
- Application logs show `ConnectionError` or `ECONNREFUSED`
- Dashboard shows stale data
- User login/registration fails

### Diagnosis Steps

1. Check Vercel function logs for connection errors
2. Verify PostgreSQL instance status in cloud provider dashboard
3. Check connection pool exhaustion: `SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction';`
4. Test database connectivity: `psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT 1"`
5. Check for long-running queries: `SELECT pid, now() - query_start, query FROM pg_stat_activity WHERE state != 'idle' ORDER BY query_start;`

### Resolution Steps

1. **Connection Pool Exhaustion**:
   - Restart affected Vercel functions
   - Increase pool size if pattern persists (update `DATABASE_URL` with `?pool_size=20`)

2. **Database Instance Down**:
   - Restart database instance via cloud provider console
   - If restart fails, restore from latest backup
   - Update DNS/connection strings if instance migrated

3. **Network Issues**:
   - Check VPC security groups allow connections from Vercel
   - Verify SSL certificates are valid
   - Test from different regions

### Escalation Path

- If database unrecoverable: Escalate to engineering lead for data restoration
- If widespread outage: Escalate to CTO for customer communication

## Redis Outage

### Symptoms

- Paystack webhook processing fails
- Cron jobs don't execute
- Application logs show Redis connection errors
- User payments stuck in "processing" state

### Diagnosis Steps

1. Check Redis instance status in cloud provider
2. Test connectivity: `redis-cli -h $REDIS_HOST -p $REDIS_PORT ping`
3. Check Redis memory usage: `redis-cli info memory`
4. Verify AOF persistence status: `redis-cli info persistence`
5. Check for long-running Lua scripts: `redis-cli script kill` (if applicable)

### Resolution Steps

1. **Redis Instance Down**:
   - Restart Redis instance
   - If AOF corrupted, follow recovery procedure in `docs/ops/redis.md`
   - Re-queue missed jobs from PostgreSQL backup

2. **Memory Exhaustion**:
   - Increase Redis instance size
   - Clear expired keys: `redis-cli keys "*" | xargs redis-cli del` (careful!)
   - Implement key expiration policies

3. **Connection Issues**:
   - Check Redis ACLs allow application connections
   - Verify TLS configuration if enabled

### Escalation Path

- If data loss: Escalate to engineering lead for job reconstruction
- If Redis cluster issues: Contact cloud provider support

## Stellar Network Degradation

### Symptoms

- Gift claims fail with "network error"
- Contract deployments timeout
- Application logs show Stellar RPC errors
- Users report "transaction failed" messages

### Diagnosis Steps

1. Check Stellar network status: https://status.stellar.org/
2. Test RPC connectivity: `curl -X POST https://soroban-rpc.stellar.org -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`
3. Check Horizon API: `curl https://horizon.stellar.org/`
4. Monitor Soroban RPC latency and error rates
5. Check application logs for `NetworkError` or `TimeoutError`

### Resolution Steps

1. **Temporary Network Issues**:
   - Implement exponential backoff retry logic
   - Switch to backup RPC endpoints if available
   - Queue failed transactions for later retry

2. **RPC Node Issues**:
   - Update RPC URLs to healthy nodes
   - Implement RPC failover in application config

3. **Horizon API Issues**:
   - Use alternative Horizon instances
   - Implement caching for frequently accessed data

### Escalation Path

- If network-wide outage: Monitor Stellar status page, no immediate action
- If application-specific: Escalate to engineering team for code fixes

## Paystack Webhook Failures

### Symptoms

- Payments don't update gift status
- Users report successful payment but gift still "pending"
- Paystack dashboard shows webhook delivery failures
- Application logs show webhook signature validation errors

### Diagnosis Steps

1. Check Vercel function logs for webhook endpoint errors
2. Verify webhook URL in Paystack dashboard matches production URL
3. Test webhook signature validation manually
4. Check Redis queue for stuck webhook jobs
5. Verify Paystack API key validity

### Resolution Steps

1. **Webhook URL Mismatch**:
   - Update webhook URL in Paystack dashboard
   - Resend failed webhooks via Paystack dashboard

2. **Signature Validation Issues**:
   - Verify `PAYSTACK_SECRET_KEY` environment variable
   - Check webhook payload parsing logic

3. **Processing Failures**:
   - Clear Redis queue and reprocess webhooks
   - Manually update affected gift statuses from Paystack dashboard data

### Escalation Path

- If Paystack API issues: Contact Paystack support
- If widespread payment failures: Escalate to CTO for payment provider communication

## Cron Job Failure

### Symptoms

- Gifts don't unlock on schedule
- Expiry processing doesn't run
- Application logs missing cron execution entries
- Vercel cron dashboard shows failures

### Diagnosis Steps

1. Check Vercel cron job status and logs
2. Verify cron schedule configuration
3. Test cron endpoints manually: `curl https://lumigift.com/api/cron/unlock`
4. Check for long-running cron jobs blocking new executions
5. Verify database connectivity from cron functions

### Resolution Steps

1. **Cron Function Errors**:
   - Fix code issues and redeploy
   - Manually trigger missed unlocks via admin interface

2. **Schedule Issues**:
   - Update cron expressions in Vercel dashboard
   - Adjust timezone settings if needed

3. **Timeout Issues**:
   - Optimize cron job performance
   - Split large jobs into batches

### Escalation Path

- If manual intervention needed: Escalate to engineering lead
- If cron system down: Contact Vercel support

## Application Performance Degradation

### Symptoms

- API response times >5 seconds
- High error rates (>5%)
- Database CPU/memory usage spikes
- User reports of slow loading

### Diagnosis Steps

1. Check Vercel function metrics and logs
2. Monitor database performance: slow query logs
3. Check Redis memory and connection counts
4. Review recent deployments for performance regressions
5. Test external API dependencies (Paystack, Stellar)

### Resolution Steps

1. **Database Performance**:
   - Add missing indexes on frequently queried columns
   - Optimize slow queries
   - Scale database instance if needed

2. **Application Issues**:
   - Roll back recent deployments if suspected
   - Implement caching for expensive operations
   - Scale Vercel function concurrency

3. **External Dependencies**:
   - Implement circuit breakers for failing services
   - Add timeouts and retry logic

### Escalation Path

- If performance doesn't improve: Escalate to engineering team for deep analysis
- If affecting revenue: Escalate to CTO

## Security Incident

### Symptoms

- Unusual login attempts or API usage
- Unexpected data modifications
- Security monitoring alerts
- User reports of unauthorized access

### Diagnosis Steps

1. Review application security logs
2. Check for suspicious IP addresses or user agents
3. Verify API key usage and permissions
4. Audit recent database changes
5. Check for malware or unauthorized code deployments

### Resolution Steps

1. **Immediate Response**:
   - Rotate compromised credentials
   - Block suspicious IPs
   - Disable affected user accounts

2. **Investigation**:
   - Preserve logs and evidence
   - Conduct security audit
   - Implement additional monitoring

3. **Recovery**:
   - Restore from clean backups if needed
   - Update security policies

### Escalation Path

- Always escalate to CTO and security team
- Involve legal if data breach suspected
- Notify affected users if necessary

## Communication Templates

### Internal Incident Update

```
🚨 Incident Update: [Brief Title]

Status: [Investigating|Identified|Resolved]
Impact: [Description of user impact]
Timeline:
- Detected: [Time]
- Current status: [What we know]
- ETA: [If known]

Next update: [Time]
```

### Customer Communication

```
Subject: Lumigift Service Update

Dear valued user,

We're experiencing [brief issue description] that may affect [specific functionality].

Our team is working to resolve this quickly. Service should be restored by [ETA].

We apologize for any inconvenience.

Best,
Lumigift Team
```

---

_This runbook is reviewed quarterly and updated as systems evolve. Last reviewed: [Date]_

## Log Aggregation

### Overview

All application logs are emitted as structured JSON (pino) to stdout. In production
the log stream is shipped to **Logtail / Betterstack** via the `LOG_AGGREGATION_URL`
and `LOG_AGGREGATION_TOKEN` environment variables.

### Setup

1. Create a **HTTP source** in Betterstack (or your chosen provider).
2. Copy the ingest URL and token into your deployment environment:
   ```
   LOG_AGGREGATION_URL=https://in.logs.betterstack.com
   LOG_AGGREGATION_TOKEN=<source-token>
   ```
3. Set `LOG_LEVEL=info` in production (use `debug` locally).

### Retention Policy

Configure **30-day retention** in the Betterstack source settings
(Sources → your source → Retention).

### Alerts

Configure the following alert rules in Betterstack (or equivalent):

| Alert            | Condition                                               | Channel          |
| ---------------- | ------------------------------------------------------- | ---------------- |
| High error rate  | `level = "error"` count > 10 in 5 min                   | Slack #incidents |
| Auth failures    | `service = "auth"` + `level = "error"` > 5 in 1 min     | Slack #incidents |
| Payment failures | `service = "paystack"` + `level = "error"` > 3 in 5 min | Slack #incidents |

### Key Metrics Dashboard

Create a dashboard with these queries:

- **Request rate**: count of `level = "info"` logs per minute
- **Error rate**: count of `level = "error"` logs per minute
- **Auth errors**: filter `service = "auth"` + `level = "error"`
- **P95 latency**: if using pino-http, filter on `responseTime` field

### Sensitive Data

The logger redacts the following fields before shipping:
`phone`, `recipientPhone`, `recipientPhoneHash`, `authorization`, `cookie`.

---

## Escrow Contract Recovery

> **Scope**: Lumigift uses a Soroban escrow contract on Stellar to time-lock USDC gifts.
> This section covers recovery procedures for stuck or failed contract operations.

### State Machine Reference

The on-chain escrow state machine has three states:

| State            | Meaning                                                    |
| ---------------- | ---------------------------------------------------------- |
| `NotInitialized` | Contract deployed but `initialize` not yet called          |
| `Initialized`    | USDC locked; waiting for `unlock_time`                     |
| `Claimed`        | Recipient called `claim`; USDC transferred                 |
| `Cancelled`      | Sender called `cancel` before `unlock_time`; USDC returned |

Query current state:

```bash
stellar contract invoke \
  --id $STELLAR_ESCROW_CONTRACT_ID \
  --network $STELLAR_NETWORK \
  -- get_state
```

---

### Incident: Failed `initialize` (Gift Never Locked)

#### Symptoms

- Gift record in PostgreSQL has `status = 'pending'` or `status = 'funded'`
- On-chain `get_state` returns `NotInitialized`
- No Stellar transaction hash recorded for the escrow funding

#### Diagnosis

1. Check the gift record in the DB:
   ```sql
   SELECT id, status, stellar_tx_hash, created_at FROM gifts WHERE id = '<gift_id>';
   ```
2. Verify on-chain state:
   ```bash
   stellar contract invoke --id $STELLAR_ESCROW_CONTRACT_ID --network testnet -- get_state
   ```
3. Check Stellar Horizon for the deploy transaction:
   ```bash
   curl "https://horizon.stellar.org/transactions/$STELLAR_TX_HASH"
   ```
4. Check application logs for `EscrowError` or `initialize` failure messages.

#### Resolution

**Option A — Re-initialize (preferred if contract is NotInitialized)**:

1. Confirm USDC has been transferred to the contract address (check Horizon).
2. Call `initialize` again via the deployment script:
   ```bash
   STELLAR_NETWORK=testnet ts-node scripts/deploy-contract.ts
   ```
3. Update the DB record with the new transaction hash:
   ```sql
   UPDATE gifts SET stellar_tx_hash = '<new_hash>', status = 'locked' WHERE id = '<gift_id>';
   ```

**Option B — Refund sender (if contract can't be initialized)**:

1. If USDC is stuck in the contract with no way to call `initialize`, escalate to engineering.
2. A contract upgrade or admin recovery path may be required.
3. Manually refund the sender from the operations wallet as a last resort.

#### Prevention

- Ensure `initialize` is called atomically with the USDC transfer in the gift creation flow.
- Monitor for gifts with `status = 'funded'` older than 10 minutes.

---

### Incident: Stuck `claim` (Recipient Cannot Claim)

#### Symptoms

- Unlock time has passed but recipient reports "claim failed"
- On-chain state is `Initialized` (not `Claimed`)
- Application logs show `HostError`, `InvokeError`, or timeout from `claim` call

#### Diagnosis

1. Confirm unlock time has passed:
   ```bash
   stellar contract invoke --id $STELLAR_ESCROW_CONTRACT_ID --network mainnet -- get_state
   # Also check unlock_time field
   ```
2. Check Stellar network status: https://status.stellar.org/
3. Review application logs for the failed claim transaction hash.
4. Check if the transaction was submitted but failed on-chain:
   ```bash
   curl "https://horizon.stellar.org/transactions/$FAILED_TX_HASH"
   ```
5. Check ledger entry TTL — if the contract entry has expired, `claim` will fail:
   ```bash
   stellar contract read --id $STELLAR_ESCROW_CONTRACT_ID --network mainnet
   ```

#### Resolution

**Case 1 — Transient network error (most common)**:

1. Retry the claim via the API or admin interface.
2. Claims are idempotent if the contract is still `Initialized`.
3. If the retry succeeds, update DB:
   ```sql
   UPDATE gifts SET status = 'claimed', claimed_at = NOW() WHERE id = '<gift_id>';
   ```

**Case 2 — Contract TTL expired (ledger entry archived)**:

1. Extend the contract TTL using the Stellar CLI:
   ```bash
   stellar contract extend \
     --id $STELLAR_ESCROW_CONTRACT_ID \
     --ledgers-to-extend 518400 \
     --source $STELLAR_SERVER_SECRET_KEY \
     --network mainnet
   ```
2. Retry the claim after TTL extension.

**Case 3 — Recipient key issue**:

1. Verify the recipient Stellar address is funded (minimum 1 XLM reserve).
2. If not, fund the recipient account before retrying:
   ```bash
   stellar account fund --account $RECIPIENT_ADDRESS --network testnet
   ```

#### Prevention

- Monitor contract TTL and auto-extend via cron before expiry.
- Alert on gifts with `unlock_time < NOW()` and `status != 'claimed'` after 30 minutes.

---

### Incident: Failed `cancel` (Sender Cannot Reclaim)

#### Symptoms

- Sender requests cancellation before unlock time
- `cancel` transaction fails or times out
- On-chain state remains `Initialized`

#### Diagnosis

1. Confirm unlock time has NOT yet passed (cancel is only valid before unlock):
   ```bash
   stellar contract invoke --id $STELLAR_ESCROW_CONTRACT_ID --network mainnet -- get_state
   ```
2. Verify the caller is the original sender (contract enforces sender-only cancel).
3. Check for Stellar network congestion or fee issues.

#### Resolution

1. Retry the cancel with an increased fee:
   ```bash
   stellar contract invoke \
     --id $STELLAR_ESCROW_CONTRACT_ID \
     --source $STELLAR_SERVER_SECRET_KEY \
     --network mainnet \
     --fee 10000 \
     -- cancel
   ```
2. If cancel succeeds, update the DB:
   ```sql
   UPDATE gifts SET status = 'cancelled', cancelled_at = NOW() WHERE id = '<gift_id>';
   ```
3. Verify USDC returned to sender via Horizon:
   ```bash
   curl "https://horizon.stellar.org/accounts/$SENDER_ADDRESS"
   ```

#### No-Duplicate-Transfer Rule

> **Critical**: Never manually transfer USDC to the sender if a `cancel` transaction is pending or has been submitted. Always verify the on-chain state before any manual action to avoid double-refund.

---

### Incident: DB ↔ On-Chain Reconciliation Mismatch

#### Symptoms

- PostgreSQL `gifts.status` does not match on-chain contract state
- Event indexer has fallen behind or missed events
- User sees wrong status in dashboard

#### Diagnosis

1. Query DB status for affected gifts:
   ```sql
   SELECT id, status, stellar_tx_hash, unlock_time, claimed_at FROM gifts
   WHERE stellar_tx_hash IS NOT NULL AND status NOT IN ('claimed', 'cancelled')
   ORDER BY unlock_time DESC LIMIT 20;
   ```
2. For each gift, check on-chain state:
   ```bash
   stellar contract invoke --id $STELLAR_ESCROW_CONTRACT_ID --network mainnet -- get_state
   ```
3. Cross-reference with Stellar event logs:
   ```bash
   stellar events \
     --id $STELLAR_ESCROW_CONTRACT_ID \
     --network mainnet \
     --start-ledger <start>
   ```

#### Resolution

1. **Reconcile manually** for each mismatched gift:
   - On-chain `Claimed` but DB `locked` → update DB to `claimed`
   - On-chain `Cancelled` but DB `locked` → update DB to `cancelled`
   - On-chain `Initialized` but DB `claimed` → investigate double-entry (escalate)

2. **Restart the event indexer** to catch up:

   ```bash
   # Trigger re-indexing via the cron endpoint
   curl -X POST https://lumigift.app/api/cron/index-events \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

3. **Verify reconciliation**:
   ```sql
   -- Should return 0 rows after successful reconciliation
   SELECT id, status FROM gifts
   WHERE stellar_tx_hash IS NOT NULL
     AND status = 'locked'
     AND unlock_time < NOW() - INTERVAL '1 hour';
   ```

#### Prevention

- Run reconciliation check daily via cron.
- Alert if any gift has `unlock_time < NOW() - 30min` and `status = 'locked'`.

---

### Escalation Path for Escrow Incidents

| Scenario                               | Action                                                         |
| -------------------------------------- | -------------------------------------------------------------- |
| Contract TTL expired                   | Engineering lead — extend TTL immediately                      |
| USDC stuck (no valid state transition) | CTO + Engineering — contract upgrade required                  |
| Double-transfer risk detected          | **STOP ALL OPERATIONS** — escalate to CTO                      |
| Reconciliation mismatch > 10 gifts     | Engineering on-call — investigate event indexer                |
| Stellar network outage                 | Monitor https://status.stellar.org/ — no action until restored |
