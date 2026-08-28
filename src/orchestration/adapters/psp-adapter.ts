/**
 * The strategy contract every payment provider implements. The orchestration
 * engine only ever talks to this interface — it never knows which vendor it is
 * driving. Adding a provider = implementing this, nothing in the engine changes.
 */
import type { ChargeInput, ChargeResult } from "../types"

export interface RefundInput {
  pspReference: string
  amount: number // minor units
  idempotencyKey: string
}

export interface RefundResult {
  status: "success" | "failed"
  refundReference?: string | null
  rawMessage?: string | null
}

export interface PSPAdapter {
  /** Stable id used in routing rules and analytics (e.g. "mock_a"). */
  readonly providerId: string

  /**
   * Capability flags. The engine and the admin/config surface read these; an
   * adapter must not advertise a capability its `charge`/`refund` don't honor.
   */
  readonly supportsExternal3DS: boolean
  readonly supportsAutomatedRefund: boolean
  readonly supportsDescriptor: boolean

  charge(input: ChargeInput): Promise<ChargeResult>
  refund(input: RefundInput): Promise<RefundResult>
  void(pspReference: string): Promise<RefundResult>
}
