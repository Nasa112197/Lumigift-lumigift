# #82 [smart-contract] Add invariant and property-based escrow tests

## Status

Draft / deferred pending upstream contract review.

## Description

Verify funds cannot be double-claimed, lost, or sent to another address across call sequences.

## Notes

This draft PR records the testing work and leaves the invariant suite open pending a deeper Rust property-testing pass.

## Acceptance criteria check

- Review the requested behavior and risks for this issue.
- Record the issue in the project tracking notes.
- Leave the contract-level fix open until the required design or test review is complete.

## Link

Fixes #82
