import { describe, it, expect } from "vitest"
import { orchestrateCharge, type OrchestrateDeps } from "../src/orchestration/orchestrate-charge"
import { AdapterRegistry } from "../src/orchestration/registry"
import { MockGateway } from "../src/orchestration/adapters/mock-gateway.adapter"
import {
  InMemoryAttemptsRepository,
  InMemoryIdempotencyStore,
  InMemoryRoutingRuleRepository,
} from "../src/orchestration/persistence/in-memory"
import type { RoutingRule } from "../src/orchestration/routing/resolve-route"
import type { ChargeInput, ThreeDSProof } from "../src/orchestration/types"

const usdRule: RoutingRule[] = [
  { priority: 1, conditions: { currency: ["USD"] }, weights: { mock_a: 70, mock_b: 30 }, fallbackOrder: [] },
]

const PROOF: ThreeDSProof = { cavv: "c", eci: "05", dsTransactionId: "d", version: "2.2.0" }

const input = (over: Partial<ChargeInput> = {}): ChargeInput => ({
  idempotencyKey: "idem_1",
  amount: 5000,
  currency: "USD",
  country: "US",
  card: { token: "tok_ok", network: "visa" },
  threeDSProof: null,
  ...over,
})

function makeDeps(rules: RoutingRule[] = usdRule) {
  const attempts = new InMemoryAttemptsRepository()
  const idempotency = new InMemoryIdempotencyStore()
  const registry = new AdapterRegistry([
    new MockGateway({ providerId: "mock_a", alwaysSoftFail: true }),
    new MockGateway({ providerId: "mock_b" }),
    new MockGateway({ providerId: "mock_3ds", requires3ds: true }),
  ])
  const deps: OrchestrateDeps = {
    rules: new InMemoryRoutingRuleRepository(rules),
    attempts,
    idempotency,
    registry,
  }
  return { deps, attempts, idempotency }
}

describe("orchestrateCharge", () => {
  it("cascades to success and records every attempt", async () => {
    const { deps, attempts } = makeDeps()
    const out = await orchestrateCharge(input(), deps)

    expect(out.finalStatus).toBe("success")
    expect(out.finalResult.providerId).toBe("mock_b")
    expect(out.replayed).toBe(false)
    expect(attempts.records.map((r) => r.providerId)).toEqual(["mock_a", "mock_b"])
  })

  it("replays a prior terminal result idempotently (no second charge)", async () => {
    const { deps, attempts } = makeDeps()
    await orchestrateCharge(input(), deps)
    const again = await orchestrateCharge(input(), deps)

    expect(again.replayed).toBe(true)
    expect(again.finalStatus).toBe("success")
    expect(attempts.records).toHaveLength(2) // not re-attempted
  })

  it("returns configuration_error when no routing rule matches", async () => {
    const { deps } = makeDeps()
    const out = await orchestrateCharge(input({ currency: "EUR" }), deps)

    expect(out.finalStatus).toBe("failed")
    expect(out.finalResult.errorCategory).toBe("configuration_error")
    expect(out.finalResult.errorCode).toBe("no_route")
  })

  it("does not store a 3DS pause; the resume runs and stores the terminal outcome", async () => {
    const threedsRule: RoutingRule[] = [
      { priority: 1, conditions: { currency: ["USD"] }, weights: { mock_3ds: 100 }, fallbackOrder: [] },
    ]
    const { deps, idempotency } = makeDeps(threedsRule)

    const first = await orchestrateCharge(input(), deps)
    expect(first.finalStatus).toBe("requires_3ds")
    expect(await idempotency.get("idem_1")).toBeNull() // pause not stored

    const resumed = await orchestrateCharge(input({ threeDSProof: PROOF }), deps)
    expect(resumed.finalStatus).toBe("success")
    expect(await idempotency.get("idem_1")).not.toBeNull() // terminal stored
  })
})
