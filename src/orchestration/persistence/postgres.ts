/**
 * Postgres implementations of the persistence ports (Drizzle). Same interfaces
 * as the in-memory versions, so the service and the engine never know which is
 * in use.
 */
import { eq } from "drizzle-orm"
import type { Db } from "../../db/client"
import { idempotencyRecord, paymentAttempt, routingRule } from "../../db/schema"
import type {
  AttemptsRepository,
  IdempotencyStore,
  PersistedAttempt,
  RoutingRuleRepository,
  StoredResult,
} from "../ports"
import type { RoutingRule } from "../routing/resolve-route"

export class PgAttemptsRepository implements AttemptsRepository {
  constructor(private readonly db: Db) {}

  async record(a: PersistedAttempt): Promise<void> {
    await this.db.insert(paymentAttempt).values({
      idempotencyKey: a.idempotencyKey,
      providerId: a.providerId,
      status: a.status,
      errorCategory: a.errorCategory,
      errorCode: a.errorCode,
      amountMinor: a.amountMinor,
      currency: a.currency,
      pspReference: a.pspReference,
    })
  }
}

export class PgRoutingRuleRepository implements RoutingRuleRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<RoutingRule[]> {
    const rows = await this.db.select().from(routingRule).where(eq(routingRule.enabled, true))
    return rows.map((r) => ({
      priority: r.priority,
      conditions: r.conditions,
      weights: r.weights,
      fallbackOrder: r.fallbackOrder,
    }))
  }
}

export class PgIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Db) {}

  async get(idempotencyKey: string): Promise<StoredResult | null> {
    const rows = await this.db
      .select()
      .from(idempotencyRecord)
      .where(eq(idempotencyRecord.idempotencyKey, idempotencyKey))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return { finalStatus: row.finalStatus, finalResult: row.finalResult }
  }

  async put(idempotencyKey: string, value: StoredResult): Promise<void> {
    // First-writer-wins: the PK on idempotency_key is the DB-level guard against
    // two concurrent charges storing conflicting terminal outcomes.
    await this.db
      .insert(idempotencyRecord)
      .values({
        idempotencyKey,
        finalStatus: value.finalStatus,
        finalResult: value.finalResult,
      })
      .onConflictDoNothing()
  }
}
