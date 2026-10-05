import { Keypair, TransactionBuilder, Operation, BASE_FEE } from "@stellar/stellar-sdk";

/** A time-bounded, spending-capped session key an agent can use on the user's behalf. */
export interface SessionKeyGrant {
  sessionPublicKey: string;
  maxAllowanceStroops: string;
  durationHours: number;
  allowedContractCalls: string[];
  expiresAt: string;
}

export const SESSION_DURATION_OPTIONS: { label: string; hours: number }[] = [
  { label: "1 hour", hours: 1 },
  { label: "12 hours", hours: 12 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
];

/**
 * Messages understood by the dedicated signing worker. Mirrors the protocol
 * implemented in `workers/sessionKeyWorker.ts` — kept as a type-only contract
 * so importing it never drags the worker (or its top-level `self` listeners)
 * into a non-worker bundle.
 */
export interface SessionKeyWorkerMessage {
  type: "INIT_KEY" | "SIGN_PAYLOAD" | "CLEAR_KEY";
  payload?: Uint8Array;
  keyId?: string;
}

/**
 * Spawns the dedicated worker that holds the ephemeral signing key in its own
 * isolated memory. The raw key bytes never touch the main thread or storage.
 */
export function initSessionKeyWorker(): Worker {
  return new Worker(new URL("../workers/sessionKeyWorker.ts", import.meta.url));
}

const STORAGE_KEY = "delego_session_key_grant";
/** Data entry name prefix used to anchor the grant on-chain via manageData. */
const MANAGE_DATA_NAME_PREFIX = "delego_session_key";

/** Generates a fresh ephemeral session keypair. The secret never leaves this module/localStorage. */
export function generateSessionKeypair(): Keypair {
  return Keypair.random();
}

/**
 * Builds the master authorization transaction the user signs to activate a
 * session key: a single `manageData` operation on their own account,
 * anchoring the session's public key, spending cap, and expiry on-chain as a
 * verifiable (if lightweight) record. This does not itself enforce spending
 * limits on-chain — that requires a session-key-aware contract, which is out
 * of scope for this UI — it establishes an auditable, wallet-signed grant.
 */
export function buildSessionKeyAuthTx(
  sourceAccount: { accountId: () => string; sequenceNumber: () => string; incrementSequenceNumber: () => void },
  grant: SessionKeyGrant,
  networkPassphrase: string
) {
  const dataName = `${MANAGE_DATA_NAME_PREFIX}:${grant.sessionPublicKey.slice(0, 8)}`;
  const dataValue = JSON.stringify({
    pk: grant.sessionPublicKey,
    cap: grant.maxAllowanceStroops,
    exp: grant.expiresAt,
  }).slice(0, 64); // manageData values are capped at 64 bytes

  return new TransactionBuilder(sourceAccount as never, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.manageData({
        name: dataName,
        value: dataValue,
      })
    )
    .setTimeout(180)
    .build();
}

export function loadSessionKeyGrant(): SessionKeyGrant | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as SessionKeyGrant) : null;
  } catch {
    return null;
  }
}

export function saveSessionKeyGrant(grant: SessionKeyGrant): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(grant));
}

export function revokeSessionKeyGrant(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
