/**
 * A deterministic in-memory PSP used to exercise the engine end to end with no
 * network, no credentials, and no real money — the way NMI/most gateways expose
 * a test mode (outcome driven by the amount and a few magic inputs).
 *
 * Configure per instance so a chain can be built from providers with different
 * behaviours (e.g. one that always soft-declines in front of one that approves)
 * to drive the cascade.
 */
import type { PSPAdapter, RefundInput, RefundResult } from "./psp-adapter"
import type { ChargeInput, ChargeResult, ErrorCategory } from "../types"

export interface MockGatewayConfig {
  providerId: string
  supportsExternal3DS?: boolean
  supportsAutomatedRefund?: boolean
  supportsDescriptor?: boolean
  /** Charges below this amount (minor units) soft-decline. Default 100 ($1). */
  declineBelowMinor?: number
  /** Always soft-decline (to put a provider "in front" for cascade tests). */
  alwaysSoftFail?: boolean
  /** Category used for the forced/threshold soft decline. */
  softFailCategory?: ErrorCategory
  /** Require a 3DS challenge on the first (unauthenticated) charge. */
  requires3ds?: boolean
  /** Require a 3DS challenge on EVERY charge, even a resumed one (edge case). */
  requires3dsAlways?: boolean
}

/** Card token that forces a terminal (hard) decline. */
export const INVALID_CARD_TOKEN = "invalid_card"

/** Card token that triggers a 3DS challenge on the first (unauthenticated) charge. */
export const THREE_DS_CARD_TOKEN = "tok_3ds"

export class MockGateway implements PSPAdapter {
  public readonly providerId: string
  public readonly supportsExternal3DS: boolean
  public readonly supportsAutomatedRefund: boolean
  public readonly supportsDescriptor: boolean

  private readonly cfg: MockGatewayConfig

  constructor(cfg: MockGatewayConfig) {
    this.cfg = cfg
    this.providerId = cfg.providerId
    this.supportsExternal3DS = cfg.supportsExternal3DS ?? true
    this.supportsAutomatedRefund = cfg.supportsAutomatedRefund ?? true
    this.supportsDescriptor = cfg.supportsDescriptor ?? false
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    // 1. Terminal decline on the magic invalid-card token.
    if (input.card.token === INVALID_CARD_TOKEN) {
      return this.decline(
        "hard_fail",
        "permanent_decline",
        "205",
        "Your card was declined. Please try a different card.",
      )
    }

    // 2. 3DS. `requires3dsAlways` challenges even on resume (used to prove the
    //    engine SKIPS a fallback's second challenge on a resume).
    if (this.cfg.requires3dsAlways) return this.challenge()
    if (this.cfg.requires3ds && input.threeDSProof == null) return this.challenge()

    // Magic 3DS test card: any provider challenges it on the unauthenticated
    // first attempt, then authorizes once a proof is present on the resume.
    if (input.card.token === THREE_DS_CARD_TOKEN && input.threeDSProof == null) {
      return this.challenge()
    }

    // 3. Forced / threshold soft decline (drives the cascade).
    const floor = this.cfg.declineBelowMinor ?? 100
    if (this.cfg.alwaysSoftFail || input.amount < floor) {
      return this.decline(
        "soft_fail",
        this.cfg.softFailCategory ?? "issuer_decline",
        "201",
        "Your bank declined this payment. Please try again or use a different card.",
      )
    }

    // 4. Approve.
    return {
      status: "success",
      providerId: this.providerId,
      errorCategory: "success",
      errorCode: null,
      rawMessage: "APPROVED",
      customerMessage: "",
      pspReference: `mock_${this.providerId}_${input.idempotencyKey}`,
      threeDSChallenge: null,
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      status: "success",
      refundReference: `refund_${input.pspReference}`,
      rawMessage: "REFUNDED",
    }
  }

  async void(pspReference: string): Promise<RefundResult> {
    return { status: "success", refundReference: `void_${pspReference}`, rawMessage: "VOIDED" }
  }

  private challenge(): ChargeResult {
    return {
      status: "requires_3ds",
      providerId: this.providerId,
      errorCategory: "requires_3ds",
      errorCode: null,
      rawMessage: "3DS_REQUIRED",
      customerMessage: "",
      pspReference: null,
      threeDSChallenge: {
        kind: "iframe",
        url: `https://mock-acs.local/challenge/${this.providerId}`,
      },
    }
  }

  private decline(
    status: ChargeResult["status"],
    errorCategory: ErrorCategory,
    errorCode: string,
    customerMessage: string,
  ): ChargeResult {
    return {
      status,
      providerId: this.providerId,
      errorCategory,
      errorCode,
      rawMessage: `DECLINED_${errorCode}`,
      customerMessage,
      pspReference: null,
      threeDSChallenge: null,
    }
  }
}
