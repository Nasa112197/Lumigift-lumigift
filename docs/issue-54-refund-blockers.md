# Issue #54: Expiry Refund Blockers

This issue cannot be completed safely from the current backend interfaces.

The expiry scheduler is still a placeholder, and the current gift model does not contain a sender Stellar address. Although the Soroban contract has a `cancel` entry point, the generated TypeScript client does not provide a server-side signed submission flow for that operation. The current code also has no durable refund-attempt record or idempotent notification store.

Before implementing expiry processing, the project needs:

- a PostgreSQL gift persistence layer and durable refund-attempt state;
- a server signing/key-management decision for the escrow sender authorization;
- a typed escrow cancellation submission method and reconciliation strategy for retries;
- an idempotent sender notification mechanism and failure-handling tests.

Implementing the cron loop before these contracts exist could mark gifts expired without recovering funds or could duplicate refunds and notifications.
