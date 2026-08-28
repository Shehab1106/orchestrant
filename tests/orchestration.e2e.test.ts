import { describe, it, expect } from "vitest"
import { executeChargeChain } from "../src/orchestration/cascade/execute-charge-chain"
import { resolveRoute, type RoutingRule } from "../src/orchestration/routing/resolve-route"
import {
  MockGateway,
  INVALID_CARD_TOKEN,
} from "../src/orchestration/adapters/mock-gateway.adapter"
import type { PSPAdapter } from "../src/orchestration/adapters/psp-adapter"
import type { ChargeInput, ThreeDSProof } from "../src/orchestration/types"

const input = (over: Partial<ChargeInput> = {}): ChargeInput => ({
  idempotencyKey: "idem_1",
  amount: 5000,
  currency: "USD",
  country: "US",
  card: { token: "tok_ok", network: "visa" },
  threeDSProof: null,
  ...over,
})

const PROOF: ThreeDSProof = {
  cavv: "abc",
  eci: "05",
  dsTransactionId: "11111111-1111-1111-1111-111111111111",
  version: "2.2.0",
}

describe("routing", () => {
  const rules: RoutingRule[] = [
    {
      priority: 1,
      conditions: { country: ["US"], currency: ["USD"] },
      weights: { mock_a: 70, mock_b: 30 },
      fallbackOrder: ["mock_stripe"],
    },
  ]

  it("orders primaries by weight, then appends the fallback", () => {
    expect(resolveRoute(rules, { country: "US", currency: "USD" })).toEqual([
      "mock_a",
      "mock_b",
      "mock_stripe",
    ])
  })

  it("returns [] when nothing matches (e.g. wrong currency)", () => {
    expect(resolveRoute(rules, { country: "US", currency: "EUR" })).toEqual([])
  })
})

describe("cascade end-to-end", () => {
  // A registry the engine would build from resolved provider ids.
  const registry: Record<string, PSPAdapter> = {
    mock_a: new MockGateway({ providerId: "mock_a", alwaysSoftFail: true }),
    mock_b: new MockGateway({ providerId: "mock_b" }),
    mock_stripe: new MockGateway({ providerId: "mock_stripe" }),
  }
  const chainFrom = (ids: string[]) => ids.map((id) => registry[id]!)

  it("route -> soft_fail on the primary -> cascade -> success on the fallback", async () => {
    const rules: RoutingRule[] = [
      {
        priority: 1,
        conditions: { currency: ["USD"] },
        weights: { mock_a: 70, mock_b: 30 },
        fallbackOrder: [],
      },
    ]
    const chain = chainFrom(resolveRoute(rules, { currency: "USD" }))
    const out = await executeChargeChain(chain, input())

    expect(out.finalStatus).toBe("success")
    expect(out.finalResult.providerId).toBe("mock_b")
    expect(out.attempts.map((a) => a.providerId)).toEqual(["mock_a", "mock_b"])
  })

  it("hard_fail stops the chain immediately (no cascade)", async () => {
    const chain = [registry.mock_a!, registry.mock_b!]
    const out = await executeChargeChain(chain, input({ card: { token: INVALID_CARD_TOKEN } }))

    expect(out.finalStatus).toBe("failed")
    expect(out.finalResult.errorCategory).toBe("permanent_decline")
    expect(out.attempts).toHaveLength(1)
  })

  it("requires_3ds pauses on the first attempt", async () => {
    const threeds = new MockGateway({ providerId: "mock_3ds", requires3ds: true })
    const out = await executeChargeChain([threeds], input())

    expect(out.finalStatus).toBe("requires_3ds")
    expect(out.finalResult.threeDSChallenge?.url).toContain("mock_3ds")
  })

  it("resume with a proof clears 3DS and succeeds", async () => {
    const threeds = new MockGateway({ providerId: "mock_3ds", requires3ds: true })
    const out = await executeChargeChain([threeds], input({ threeDSProof: PROOF }))

    expect(out.finalStatus).toBe("success")
    expect(out.finalResult.providerId).toBe("mock_3ds")
  })

  it("skip-on-resume: a fallback's fresh challenge is suppressed on a resume", async () => {
    const a = new MockGateway({ providerId: "mock_a", alwaysSoftFail: true })
    const alwaysChallenges = new MockGateway({ providerId: "mock_b", requires3dsAlways: true })
    const out = await executeChargeChain([a, alwaysChallenges], input({ threeDSProof: PROOF }))

    // A soft-fails, B would challenge again but we are resuming -> skipped ->
    // chain exhausts as failed, NOT a second challenge.
    expect(out.finalStatus).toBe("failed")
    expect(out.attempts.map((x) => x.providerId)).toEqual(["mock_a", "mock_b"])
  })
})
