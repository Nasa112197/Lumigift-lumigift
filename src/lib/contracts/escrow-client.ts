/**
 * Typed TypeScript client for the Lumigift Escrow Soroban contract.
 *
 * AUTO-GENERATED via `npm run contract:bindings` — do not edit by hand.
 * Regenerate whenever the contract ABI changes:
 *
 *   npm run contract:build && npm run contract:bindings
 *
 * The CI `contract-bindings-sync` job will fail if this file is out of sync
 * with the compiled WASM.
 */

import {
  Contract,
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";

// ─── Error codes (mirrors EscrowError in lib.rs) ──────────────────────────────

export enum EscrowError {
  AlreadyInitialized = 1,
  AlreadyClaimed = 2,
  StillLocked = 3,
  NotInitialized = 4,
  Unauthorized = 5,
  AlreadyCancelled = 6,
  InvalidAmount = 7,
  InvalidUnlockTime = 8,
  /** The supplied token address is not an allowed USDC contract for this network. */
  InvalidToken = 9,
}

export class EscrowContractError extends Error {
  constructor(public readonly code: EscrowError) {
    super(`EscrowError(${EscrowError[code]} = ${code})`);
    this.name = "EscrowContractError";
  }
}

// ─── Return types ─────────────────────────────────────────────────────────────

/**
 * Explicit lifecycle status for the escrow, mirroring the `EscrowStatus` enum
 * in the Soroban contract (contracts/escrow/src/lib.rs).
 *
 * Terminal states (`Claimed`, `Cancelled`) are mutually exclusive and can
 * never transition back to a non-terminal state.
 */
export enum EscrowStatus {
  /** Funds are locked; the unlock time has not been reached. */
  Locked = 0,
  /** The unlock time has passed but the recipient has not yet claimed. */
  Unlocked = 1,
  /** The recipient successfully claimed the funds (terminal). */
  Claimed = 2,
  /** The sender cancelled the escrow and funds were returned (terminal). */
  Cancelled = 3,
}

export interface EscrowState {
  recipient: string; // Stellar public key (G…)
  amount: bigint; // stroops (7 decimal places)
  unlockTime: bigint; // Unix timestamp (seconds)
  claimed: boolean;
}

// ─── Client options ───────────────────────────────────────────────────────────

export interface EscrowClientOptions {
  /** Soroban RPC endpoint URL */
  rpcUrl: string;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Deployed escrow contract ID (C…) */
  contractId: string;
  /** Source account public key used to simulate/submit transactions */
  sourcePublicKey: string;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class EscrowClient {
  private readonly rpc: SorobanRpc.Server;
  private readonly contract: Contract;
  private readonly opts: EscrowClientOptions;

  constructor(opts: EscrowClientOptions) {
    this.opts = opts;
    this.rpc = new SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
    this.contract = new Contract(opts.contractId);
  }

  // ── initialize ──────────────────────────────────────────────────────────────

  /**
   * Builds an `initialize` transaction envelope ready to be signed and submitted.
   *
   * @param sender      - Stellar public key of the gift sender (G…)
   * @param recipient   - Stellar public key of the gift recipient (G…)
   * @param token       - USDC contract address (C…)
   * @param amount      - Amount in stroops (i128)
   * @param unlockTime  - Unix timestamp (u64) after which the gift can be claimed
   */
  async buildInitialize(
    sender: string,
    recipient: string,
    token: string,
    amount: bigint,
    unlockTime: bigint
  ): Promise<string> {
    const account = await this.rpc.getAccount(this.opts.sourcePublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.opts.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          "initialize",
          new Address(sender).toScVal(),
          new Address(recipient).toScVal(),
          new Address(token).toScVal(),
          nativeToScVal(amount, { type: "i128" }),
          nativeToScVal(unlockTime, { type: "u64" })
        )
      )
      .setTimeout(30)
      .build();

    const simResult = await this.rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw parseContractError(simResult.error);
    }

    return SorobanRpc.assembleTransaction(tx, simResult).build().toXDR();
  }

  // ── claim ────────────────────────────────────────────────────────────────────

  /**
   * Builds a `claim` transaction envelope ready to be signed and submitted.
   */
  async buildClaim(): Promise<string> {
    const account = await this.rpc.getAccount(this.opts.sourcePublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.opts.networkPassphrase,
    })
      .addOperation(this.contract.call("claim"))
      .setTimeout(30)
      .build();

    const simResult = await this.rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw parseContractError(simResult.error);
    }

    return SorobanRpc.assembleTransaction(tx, simResult).build().toXDR();
  }

  // ── get_state ────────────────────────────────────────────────────────────────

  /**
   * Simulates `get_state` and returns the decoded escrow state.
   * This is a read-only call — no transaction is submitted.
   */
  async getState(): Promise<EscrowState> {
    const account = await this.rpc.getAccount(this.opts.sourcePublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.opts.networkPassphrase,
    })
      .addOperation(this.contract.call("get_state"))
      .setTimeout(30)
      .build();

    const simResult = await this.rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw parseContractError(simResult.error);
    }

    const returnVal = (simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse).result
      ?.retval;
    if (!returnVal) {
      throw new Error("get_state simulation returned no value");
    }

    return decodeGetStateResult(returnVal);
  }

  // ── get_status ────────────────────────────────────────────────────────────────

  /**
   * Simulates `get_status` and returns the explicit `EscrowStatus` enum value.
   *
   * This is the preferred method for backend reconciliation over `getState`
   * because it returns a single unambiguous lifecycle status:
   *
   * - `EscrowStatus.Locked`    — funds locked, unlock time not yet reached
   * - `EscrowStatus.Unlocked`  — unlock time reached, not yet claimed
   * - `EscrowStatus.Claimed`   — funds transferred to recipient (terminal)
   * - `EscrowStatus.Cancelled` — sender cancelled, funds returned (terminal)
   *
   * Terminal states cannot contradict each other — the contract enforces this.
   */
  async getStatus(): Promise<EscrowStatus> {
    const account = await this.rpc.getAccount(this.opts.sourcePublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.opts.networkPassphrase,
    })
      .addOperation(this.contract.call("get_status"))
      .setTimeout(30)
      .build();

    const simResult = await this.rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw parseContractError(simResult.error);
    }

    const returnVal = (simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse).result
      ?.retval;
    if (!returnVal) {
      throw new Error("get_status simulation returned no value");
    }

    return decodeGetStatusResult(returnVal);
  }

  // ── submitTransaction ────────────────────────────────────────────────────────

  /**
   * Submits a signed XDR transaction envelope and polls until finalized.
   *
   * @param signedXdr - Base64-encoded signed transaction XDR
   * @returns The transaction hash
   */
  async submitTransaction(signedXdr: string): Promise<string> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.opts.networkPassphrase);
    const sendResult = await this.rpc.sendTransaction(tx);

    if (sendResult.status === "ERROR") {
      throw new Error(`Transaction submission failed: ${sendResult.errorResult}`);
    }

    const hash = sendResult.hash;
    let getResult = await this.rpc.getTransaction(hash);

    // Poll until the transaction is finalized (max ~30 s)
    const deadline = Date.now() + 30_000;
    while (
      getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
      Date.now() < deadline
    ) {
      await sleep(1_000);
      getResult = await this.rpc.getTransaction(hash);
    }

    if (getResult.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed: ${hash}`);
    }

    return hash;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeGetStateResult(val: xdr.ScVal): EscrowState {
  // get_state returns a tuple: (Address, i128, u64, bool)
  const items = val.vec();
  if (!items || items.length !== 4) {
    throw new Error(`Unexpected get_state return shape: ${JSON.stringify(val)}`);
  }
  const [recipientVal, amountVal, unlockTimeVal, claimedVal] = items;
  return {
    recipient: Address.fromScVal(recipientVal).toString(),
    amount: BigInt(scValToNative(amountVal) as number | bigint),
    unlockTime: BigInt(scValToNative(unlockTimeVal) as number | bigint),
    claimed: scValToNative(claimedVal) as boolean,
  };
}

function decodeGetStatusResult(val: xdr.ScVal): EscrowStatus {
  // get_status returns an EscrowStatus enum — Soroban encodes it as a u32 ScVal.
  const native = scValToNative(val) as number;
  switch (native) {
    case 0: return EscrowStatus.Locked;
    case 1: return EscrowStatus.Unlocked;
    case 2: return EscrowStatus.Claimed;
    case 3: return EscrowStatus.Cancelled;
    default:
      throw new Error(`Unknown EscrowStatus value: ${native}`);
  }
}

function parseContractError(errorMsg: string): EscrowContractError | Error {
  // Soroban error strings contain the u32 error code, e.g. "Error(Contract, #3)"
  const match = errorMsg.match(/#(\d+)/);
  if (match) {
    const code = parseInt(match[1], 10) as EscrowError;
    if (code in EscrowError) return new EscrowContractError(code);
  }
  return new Error(errorMsg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates an {@link EscrowClient} from environment variables.
 * Requires: STELLAR_RPC_URL, STELLAR_NETWORK_PASSPHRASE,
 *           STELLAR_ESCROW_CONTRACT_ID, STELLAR_SERVER_PUBLIC_KEY
 */
export function createEscrowClient(): EscrowClient {
  const rpcUrl =
    process.env.STELLAR_RPC_URL ??
    (process.env.STELLAR_NETWORK === "mainnet"
      ? "https://soroban-rpc.stellar.org"
      : "https://soroban-testnet.stellar.org");

  const networkPassphrase =
    process.env.STELLAR_NETWORK_PASSPHRASE ??
    (process.env.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET);

  const contractId = process.env.STELLAR_ESCROW_CONTRACT_ID;
  if (!contractId) throw new Error("Missing STELLAR_ESCROW_CONTRACT_ID");

  const sourcePublicKey = process.env.STELLAR_SERVER_PUBLIC_KEY;
  if (!sourcePublicKey) throw new Error("Missing STELLAR_SERVER_PUBLIC_KEY");

  return new EscrowClient({ rpcUrl, networkPassphrase, contractId, sourcePublicKey });
}
