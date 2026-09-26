# Issue #52: Persistence Blockers

This issue needs a database contract before the in-memory gift store can be replaced safely.

The current checkout does not define a `gifts` table migration or a repository/transaction abstraction. Gift fields are represented only by the TypeScript `Gift` type and the process-local `gifts` map in `src/server/services/gift.service.ts`. The existing migrations only alter an already-existing `gifts` table.

Before implementation, the project needs:

- an authoritative `gifts` table migration covering every persisted `Gift` field and ownership indexes;
- a decision on transaction boundaries with Paystack and Stellar operations;
- repository methods for creation, ownership-scoped lookup, pagination, and conditional status updates;
- integration tests against PostgreSQL covering restart and multi-instance behavior.

Implementing the service migration without those decisions would risk data loss, mismatched columns, and non-atomic payment state transitions.
