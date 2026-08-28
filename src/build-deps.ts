/**
 * Assembles the orchestration dependency graph for the running app. Uses
 * Postgres when DATABASE_URL is set, otherwise an in-memory store seeded with a
 * demo rule — so the API runs with zero setup while staying production-ready.
 *
 * The adapter registry currently holds demo providers: mock_a always
 * soft-declines so the cascade is visible on every charge, mock_b approves.
 * Real adapters replace these without touching the engine or the service.
 */
import { AdapterRegistry } from "./orchestration/registry"
import { MockGateway } from "./orchestration/adapters/mock-gateway.adapter"
import type { OrchestrateDeps } from "./orchestration/orchestrate-charge"
import {
  InMemoryAttemptsRepository,
  InMemoryIdempotencyStore,
  InMemoryRoutingRuleRepository,
} from "./orchestration/persistence/in-memory"
import {
  PgAttemptsRepository,
  PgIdempotencyStore,
  PgRoutingRuleRepository,
} from "./orchestration/persistence/postgres"
import { getDb } from "./db/client"
import type { RoutingRule } from "./orchestration/routing/resolve-route"

function demoRegistry(): AdapterRegistry {
  return new AdapterRegistry([
    new MockGateway({ providerId: "mock_a", alwaysSoftFail: true }),
    new MockGateway({ providerId: "mock_b" }),
  ])
}

const DEMO_RULES: RoutingRule[] = [
  { priority: 1, conditions: { currency: ["USD"] }, weights: { mock_a: 70, mock_b: 30 }, fallbackOrder: [] },
]

let cached: OrchestrateDeps | null = null

export function buildDeps(): OrchestrateDeps {
  if (cached) return cached

  const registry = demoRegistry()

  if (process.env.DATABASE_URL) {
    const db = getDb()
    cached = {
      rules: new PgRoutingRuleRepository(db),
      attempts: new PgAttemptsRepository(db),
      idempotency: new PgIdempotencyStore(db),
      registry,
    }
  } else {
    cached = {
      rules: new InMemoryRoutingRuleRepository(DEMO_RULES),
      attempts: new InMemoryAttemptsRepository(),
      idempotency: new InMemoryIdempotencyStore(),
      registry,
    }
  }

  return cached
}
