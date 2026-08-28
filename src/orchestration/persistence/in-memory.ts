/**
 * In-memory implementations of the persistence ports. Used by the service
 * tests and for local runs without a database. The Postgres implementations
 * live alongside these and satisfy the same interfaces.
 */
import type {
  AttemptsRepository,
  IdempotencyStore,
  PersistedAttempt,
  RoutingRuleRepository,
  StoredResult,
} from "../ports"
import type { RoutingRule } from "../routing/resolve-route"

export class InMemoryAttemptsRepository implements AttemptsRepository {
  public readonly records: PersistedAttempt[] = []

  async record(attempt: PersistedAttempt): Promise<void> {
    this.records.push(attempt)
  }
}

export class InMemoryRoutingRuleRepository implements RoutingRuleRepository {
  constructor(private readonly rules: readonly RoutingRule[]) {}

  async list(): Promise<RoutingRule[]> {
    return [...this.rules]
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly byKey = new Map<string, StoredResult>()

  async get(idempotencyKey: string): Promise<StoredResult | null> {
    return this.byKey.get(idempotencyKey) ?? null
  }

  async put(idempotencyKey: string, value: StoredResult): Promise<void> {
    this.byKey.set(idempotencyKey, value)
  }
}
