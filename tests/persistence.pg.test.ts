/**
 * The Postgres persistence layer, actually executed.
 *
 * The engine is tested in-memory; the Drizzle/Postgres repositories that back it
 * in production were only asserted, never run. This suite stands up a real
 * Postgres (via testcontainers), applies the committed Drizzle migrations, and
 * exercises the repositories against the live database: the idempotency store
 * stores and replays a terminal outcome and — the guarantee that matters —
 * refuses to double-store the same key even under a concurrent race, routing
 * rules list only the enabled ones, and every attempt is recorded in order.
 *
 * Needs Docker. Excluded from the default `vitest run`; runs via `npm run test:db`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { Pool } from "pg"
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import * as schema from "../src/db/schema"
import {
  PgAttemptsRepository,
  PgIdempotencyStore,
  PgRoutingRuleRepository,
} from "../src/orchestration/persistence/postgres"
import type { StoredResult, PersistedAttempt } from "../src/orchestration/ports"

const here = dirname(fileURLToPath(import.meta.url))

let container: StartedPostgreSqlContainer
let pool: Pool
let db: NodePgDatabase<typeof schema>

const stored = (status: "success" | "failed", provider: string): StoredResult => ({
  finalStatus: status,
  finalResult: {
    status: status === "success" ? "success" : "hard_fail",
    providerId: provider,
    errorCategory: status === "success" ? "success" : "issuer_decline",
    errorCode: null,
    rawMessage: null,
    customerMessage: "",
    pspReference: status === "success" ? `psp_${provider}` : null,
    threeDSChallenge: null,
  },
})

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new Pool({ connectionString: container.getConnectionUri(), max: 12 })
  db = drizzle(pool, { schema })
  await migrate(db, { migrationsFolder: join(here, "../drizzle") })
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

describe("Postgres persistence (Drizzle)", () => {
  it("stores and replays a terminal outcome", async () => {
    const store = new PgIdempotencyStore(db)
    expect(await store.get("k_roundtrip")).toBeNull()
    await store.put("k_roundtrip", stored("success", "mock_b"))
    const got = await store.get("k_roundtrip")
    expect(got?.finalStatus).toBe("success")
    expect(got?.finalResult.providerId).toBe("mock_b")
  })

  it("first write wins: a second put for the same key is ignored", async () => {
    const store = new PgIdempotencyStore(db)
    await store.put("k_first", stored("success", "first"))
    await store.put("k_first", stored("failed", "second"))
    const got = await store.get("k_first")
    expect(got?.finalResult.providerId).toBe("first")
  })

  it("never double-stores the same key under a concurrent race", async () => {
    const store = new PgIdempotencyStore(db)
    await Promise.all([
      store.put("k_race", stored("success", "A")),
      store.put("k_race", stored("failed", "B")),
    ])
    const { rows } = await pool.query(
      "select count(*)::int as n from idempotency_record where idempotency_key = 'k_race'",
    )
    expect(rows[0].n).toBe(1)
    const got = await store.get("k_race")
    expect(["A", "B"]).toContain(got?.finalResult.providerId)
  })

  it("lists only enabled routing rules, mapped to the engine shape", async () => {
    await db.insert(schema.routingRule).values([
      { priority: 1, conditions: { currency: ["USD"] }, weights: { mock_a: 70, mock_b: 30 }, fallbackOrder: [], enabled: true },
      { priority: 2, conditions: {}, weights: { disabled_only: 100 }, fallbackOrder: [], enabled: false },
    ])
    const rules = await new PgRoutingRuleRepository(db).list()
    expect(rules.some((r) => "disabled_only" in r.weights)).toBe(false)
    const usd = rules.find((r) => r.conditions.currency?.includes("USD"))
    expect(usd?.weights).toEqual({ mock_a: 70, mock_b: 30 })
  })

  it("records every attempt for a charge, in order", async () => {
    const repo = new PgAttemptsRepository(db)
    const base: Omit<PersistedAttempt, "providerId" | "status" | "errorCategory" | "errorCode" | "pspReference"> = {
      idempotencyKey: "att_1",
      amountMinor: 5000,
      currency: "USD",
    }
    await repo.record({ ...base, providerId: "mock_a", status: "soft_fail", errorCategory: "issuer_decline", errorCode: "201", pspReference: null })
    await repo.record({ ...base, providerId: "mock_b", status: "success", errorCategory: "success", errorCode: null, pspReference: "psp_b" })
    const { rows } = await pool.query(
      "select provider_id, status from payment_attempt where idempotency_key = 'att_1' order by id",
    )
    expect(rows.map((r) => r.provider_id)).toEqual(["mock_a", "mock_b"])
  })
})
