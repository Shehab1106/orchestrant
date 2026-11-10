/**
 * Application service: the entry point the API route calls. It wires the pure
 * engine (routing + cascade) to persistence (idempotency, attempts) — but holds
 * no framework or DB knowledge itself; everything comes in through ports.
 *
 * Flow:
 *   1. Idempotent replay — if this key already has a terminal outcome, return it
 *      (never re-charge). A 3DS pause was never stored, so a resume falls through.
 *   2. Resolve the provider chain from the routing rules.
 *   3. Run the cascade.
 *   4. Record every attempt.
 *   5. Store the terminal outcome for future replay (not a 3DS pause).
 */
import { executeChargeChain, type OrchestrationResult } from "./cascade/execute-charge-chain"
import { resolveRoute } from "./routing/resolve-route"
import type { PSPAdapter } from "./adapters/psp-adapter"
import type { AdapterRegistry } from "./registry"
import type { AttemptsRepository, IdempotencyStore, RoutingRuleRepository } from "./ports"
import type { ChargeInput, ChargeResult } from "./types"

export interface OrchestrateDeps {
  rules: RoutingRuleRepository
  attempts: AttemptsRepository
  idempotency: IdempotencyStore
  registry: AdapterRegistry
}

export interface OrchestrateChargeResult extends OrchestrationResult {
  /** true when this response came from the idempotency store, not a fresh charge. */
  replayed: boolean
  /** The ordered provider chain the router resolved for this charge context. */
  route: string[]
}

export async function orchestrateCharge(
  input: ChargeInput,
  deps: OrchestrateDeps,
): Promise<OrchestrateChargeResult> {
  const prior = await deps.idempotency.get(input.idempotencyKey)
  if (prior) {
    return {
      finalStatus: prior.finalStatus,
      finalResult: prior.finalResult,
      attempts: [],
      replayed: true,
      route: [],
    }
  }

  const rules = await deps.rules.list()
  const providerIds = resolveRoute(rules, {
    country: input.country,
    currency: input.currency,
    network: input.card.network,
  })

  const chain: PSPAdapter[] = []
  for (const id of providerIds) {
    const adapter = deps.registry.get(id)
    if (adapter) chain.push(adapter)
  }

  if (chain.length === 0) {
    return { ...noRoute(providerIds.length === 0), replayed: false, route: providerIds }
  }

  const out = await executeChargeChain(chain, input)

  for (const attempt of out.attempts) {
    await deps.attempts.record({
      idempotencyKey: input.idempotencyKey,
      providerId: attempt.providerId,
      status: attempt.result.status,
      errorCategory: attempt.result.errorCategory,
      errorCode: attempt.result.errorCode ?? null,
      amountMinor: input.amount,
      currency: input.currency,
      pspReference: attempt.result.pspReference ?? null,
    })
  }

  if (out.finalStatus !== "requires_3ds") {
    await deps.idempotency.put(input.idempotencyKey, {
      finalStatus: out.finalStatus,
      finalResult: out.finalResult,
    })
  }

  return { ...out, replayed: false, route: providerIds }
}

/** No rule matched, or none of the resolved providers are registered. */
function noRoute(noRuleMatched: boolean): OrchestrationResult {
  const finalResult: ChargeResult = {
    status: "hard_fail",
    providerId: "-",
    errorCategory: "configuration_error",
    errorCode: "no_route",
    rawMessage: noRuleMatched
      ? "no routing rule matched the charge context"
      : "no adapter registered for the resolved providers",
    customerMessage: "Payment could not be processed. Please try again later.",
    pspReference: null,
    threeDSChallenge: null,
  }
  return { finalStatus: "failed", finalResult, attempts: [] }
}
