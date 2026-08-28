/**
 * The cascade engine — the heart of the orchestrator.
 *
 * Given an ORDERED chain of providers and one charge input, it walks the chain
 * applying the retry model:
 *
 *   success       → stop, we won
 *   soft_fail     → cascade to the next provider
 *   timeout       → cascade (a reconciliation job verifies the timed-out one later)
 *   requires_3ds  → pause and return the challenge to the caller
 *   hard_fail     → stop the chain (a verdict on the card, not the provider)
 *
 * SKIP-ON-RESUME: when the input already carries a `threeDSProof` (the caller is
 * resuming after a completed challenge), a fallback provider that would raise a
 * FRESH challenge is skipped instead of returned — the shopper authenticated
 * once and must never be challenged twice by the cascade.
 */
import type { PSPAdapter } from "../adapters/psp-adapter"
import type { ChargeInput, ChargeResult } from "../types"

export interface AttemptRecord {
  providerId: string
  result: ChargeResult
}

export type FinalStatus = "success" | "failed" | "requires_3ds"

export interface OrchestrationResult {
  finalStatus: FinalStatus
  /** The result that terminated the chain (the success, the challenge, or the last decline). */
  finalResult: ChargeResult
  /** Every attempt, in order — the audit trail. */
  attempts: AttemptRecord[]
}

export async function executeChargeChain(
  chain: readonly PSPAdapter[],
  input: ChargeInput,
): Promise<OrchestrationResult> {
  const attempts: AttemptRecord[] = []
  const isResume = input.threeDSProof != null
  let last: ChargeResult | null = null

  for (const adapter of chain) {
    const result = await adapter.charge(input)
    attempts.push({ providerId: adapter.providerId, result })
    last = result

    if (result.status === "success") {
      return { finalStatus: "success", finalResult: result, attempts }
    }

    if (result.status === "requires_3ds") {
      // Suppress a fallback's second challenge on a resume; otherwise pause.
      if (isResume) continue
      return { finalStatus: "requires_3ds", finalResult: result, attempts }
    }

    if (result.status === "soft_fail" || result.status === "timeout") {
      continue // cascade to the next provider
    }

    // hard_fail — terminal verdict on the card. Stop.
    break
  }

  // Chain exhausted (or a hard_fail broke out). `last` is always set because a
  // non-empty chain ran at least once; guard for the empty-chain case.
  if (last == null) {
    throw new Error("executeChargeChain called with an empty provider chain")
  }
  return { finalStatus: "failed", finalResult: last, attempts }
}
