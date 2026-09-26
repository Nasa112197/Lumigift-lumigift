//! Benchmark tests for the Lumigift escrow contract.
//!
//! Measures Soroban CPU, memory, and ledger resources for the two most
//! important entry-points: `initialize` and `claim`.
//!
//! Run with:
//!   cargo bench --manifest-path contracts/escrow/Cargo.toml
//!
//! The thresholds below are the regression guards for issue #86.
//! CI fails if either operation exceeds any limit.

use criterion::{criterion_group, criterion_main, Criterion};
use lumigift_escrow::EscrowContract;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Env,
};

// ─── Regression thresholds ────────────────────────────────────────────────────
//
// These are conservative upper bounds derived from the first measured run.
// Tighten them as the contract matures.
//
// Soroban fee formula (approximation, Stellar Protocol 21):
//   fee_stroops ≈ cpu_instructions / 10_000
//   1 XLM = 10_000_000 stroops
//
// At 1 XLM ≈ $0.12 USD and 1 USDC gift:
//   initialize: 500_000 instructions → 50 stroops → ~$0.000_000_6 USD
//   claim:      300_000 instructions → 30 stroops → ~$0.000_000_4 USD
//
// See BENCHMARKS.md for the full fee breakdown.

const INITIALIZE_CPU_LIMIT: u64 = 500_000;
const CLAIM_CPU_LIMIT: u64 = 300_000;
const INITIALIZE_MEMORY_LIMIT: u64 = 1_000_000;
const CLAIM_MEMORY_LIMIT: u64 = 500_000;
const INITIALIZE_LEDGER_READ_BYTES_LIMIT: u64 = 100_000;
const CLAIM_LEDGER_READ_BYTES_LIMIT: u64 = 100_000;
const INITIALIZE_LEDGER_WRITE_BYTES_LIMIT: u64 = 100_000;
const CLAIM_LEDGER_WRITE_BYTES_LIMIT: u64 = 100_000;

macro_rules! assert_budget {
    ($env:expr, $operation:expr, $cpu_limit:expr, $memory_limit:expr,
        $ledger_read_bytes_limit:expr, $ledger_write_bytes_limit:expr) => {{
    let budget = $env.cost_estimate().budget();
    let resources = $env.cost_estimate().resources();
    assert!(
        budget.cpu_instruction_cost() <= $cpu_limit,
        "{} used {} CPU instructions, exceeds limit of {}",
        $operation,
        budget.cpu_instruction_cost(),
        $cpu_limit
    );
    assert!(
        budget.memory_bytes_cost() <= $memory_limit,
        "{} used {} memory bytes, exceeds limit of {}",
        $operation,
        budget.memory_bytes_cost(),
        $memory_limit
    );
    assert!(
        resources.disk_read_bytes as u64 <= $ledger_read_bytes_limit,
        "{} read {} ledger bytes, exceeds limit of {}",
        $operation,
        resources.disk_read_bytes,
        $ledger_read_bytes_limit
    );
    assert!(
        resources.write_bytes as u64 <= $ledger_write_bytes_limit,
        "{} wrote {} ledger bytes, exceeds limit of {}",
        $operation,
        resources.write_bytes,
        $ledger_write_bytes_limit
    );
    }};
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn make_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

fn bench_initialize(c: &mut Criterion) {
    c.bench_function("initialize", |b| {
        b.iter(|| {
            let env = make_env();
            let sender = soroban_sdk::Address::generate(&env);
            let recipient = soroban_sdk::Address::generate(&env);
            let token_id = env.register_stellar_asset_contract(sender.clone());
            StellarAssetClient::new(&env, &token_id).mint(&sender, &100_000_000);

            let contract_id = env.register_contract(None, EscrowContract);
            let client = lumigift_escrow::EscrowContractClient::new(&env, &contract_id);

            client.initialize(&sender, &recipient, &token_id, &100_000_000, &3_601);

            assert_budget!(
                env,
                "initialize",
                INITIALIZE_CPU_LIMIT,
                INITIALIZE_MEMORY_LIMIT,
                INITIALIZE_LEDGER_READ_BYTES_LIMIT,
                INITIALIZE_LEDGER_WRITE_BYTES_LIMIT,
            );
        });
    });
}

fn bench_claim(c: &mut Criterion) {
    c.bench_function("claim", |b| {
        b.iter(|| {
            let env = make_env();
            let sender = soroban_sdk::Address::generate(&env);
            let recipient = soroban_sdk::Address::generate(&env);
            let token_id = env.register_stellar_asset_contract(sender.clone());
            StellarAssetClient::new(&env, &token_id).mint(&sender, &100_000_000);

            let contract_id = env.register_contract(None, EscrowContract);
            let client = lumigift_escrow::EscrowContractClient::new(&env, &contract_id);

            client.initialize(&sender, &recipient, &token_id, &100_000_000, &3_601);
            env.ledger().with_mut(|l| l.timestamp = 3_601);

            // Reset cost estimate to measure only the claim call.
            let mut budget = env.cost_estimate().budget();
            budget.reset_tracker();
            client.claim();

            assert_budget!(
                env,
                "claim",
                CLAIM_CPU_LIMIT,
                CLAIM_MEMORY_LIMIT,
                CLAIM_LEDGER_READ_BYTES_LIMIT,
                CLAIM_LEDGER_WRITE_BYTES_LIMIT,
            );
        });
    });
}

criterion_group!(benches, bench_initialize, bench_claim);
criterion_main!(benches);
