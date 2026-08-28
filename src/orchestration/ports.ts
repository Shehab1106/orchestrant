/**
 * Persistence ports. The engine and the application service depend ONLY on
 * these interfaces, never on a concrete database. That keeps the core testable
 * in-memory and lets Postgres (or anything else) plug in behind them.
 */
import type { OrchestrationResult } from "./cascade/execute-charge-chain"
import type { RoutingRule } from "./routing/resolve-route"

/** One charge attempt, flattened for storage/analytics. */
export interface PersistedAttempt {
  idempotencyKey: string
  providerId: string
  status: string
  errorCategory: string
  errorCode: string | null
  amountMinor: number
  currency: string
  pspReference: string | null
}

export interface AttemptsRepository {
  record(attempt: PersistedAttempt): Promise<void>
}

export interface RoutingRuleRepository {
  /** Active rules, in any order (the resolver sorts by priority). */
  list(): Promise<RoutingRule[]>
}

/** A terminal charge outcome, stored for idempotent replay. */
export interface StoredResult {
  finalStatus: OrchestrationResult["finalStatus"]
  finalResult: OrchestrationResult["finalResult"]
}

/**
 * Keyed by the caller's idempotency key. Only TERMINAL outcomes are stored
 * (success / failed) — a `requires_3ds` pause is never stored, because the
 * resume must be allowed to run.
 */
export interface IdempotencyStore {
  get(idempotencyKey: string): Promise<StoredResult | null>
  put(idempotencyKey: string, value: StoredResult): Promise<void>
}
