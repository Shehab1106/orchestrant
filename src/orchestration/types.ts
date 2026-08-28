/**
 * Core domain types for the orchestration engine.
 *
 * Money is ALWAYS in minor units (cents / the currency's smallest unit) as an
 * integer. Never floats, never major units — the same rule the engine enforces
 * end to end.
 */

/** An amount in minor units (e.g. 5000 = $50.00). */
export type Money = number

export type CardNetwork =
  | "visa"
  | "mastercard"
  | "amex"
  | "discover"
  | "unknown"

/**
 * A reference to a card. In a real deployment this is a vault token that a
 * PCI vault detokenizes at egress — never a raw PAN. The mock gateway treats
 * the token string as opaque.
 */
export interface CardRef {
  token: string
  network?: CardNetwork
  last4?: string
}

/**
 * A 3D Secure authentication proof. Present on a RESUMED charge, after the
 * cardholder completed the challenge, so the provider can authorize with the
 * liability shift attached.
 */
export interface ThreeDSProof {
  cavv: string
  /** Electronic Commerce Indicator, as a string (e.g. "05"). */
  eci: string
  /** 3DS2 Directory Server Transaction ID (a UUID). */
  dsTransactionId: string
  /** Protocol version, e.g. "2.2.0". */
  version: string
}

export interface ChargeInput {
  /** Idempotency key — one per checkout attempt, stable across the cascade. */
  idempotencyKey: string
  amount: Money
  /** ISO 4217 currency code, e.g. "USD". */
  currency: string
  card: CardRef
  /** Billing country, ISO 3166-1 alpha-2. Used for routing. */
  country?: string
  /** Present only on a resumed charge, after a 3DS challenge completed. */
  threeDSProof?: ThreeDSProof | null
}

/**
 * The retry-semantic status of a single charge attempt. This is the ONLY field
 * that drives the cascade decision.
 */
export type ChargeStatus =
  | "success"
  | "soft_fail" // recoverable — cascade to the next provider
  | "hard_fail" // terminal — stop the chain
  | "requires_3ds" // pause for a 3DS challenge
  | "timeout" // no answer in time — treat like soft_fail, reconcile later

/**
 * Analytics bucket for a decline. Independent of `status` (a soft-failing
 * provider outage and a soft-failing issuer decline both cascade, but are
 * counted separately).
 */
export type ErrorCategory =
  | "issuer_decline"
  | "insufficient_funds"
  | "permanent_decline"
  | "fraud_suspected"
  | "provider_unavailable"
  | "unsupported_method"
  | "configuration_error"
  | "transient_error"
  | "requires_3ds"
  | "unknown"
  | "success"

/** What the frontend needs to run a 3DS challenge. */
export interface ThreeDSChallenge {
  kind: "redirect" | "iframe"
  url: string
}

/** The normalized result of one charge attempt against one provider. */
export interface ChargeResult {
  status: ChargeStatus
  providerId: string
  errorCategory: ErrorCategory
  errorCode?: string | null
  rawMessage?: string | null
  /** Shopper-facing message. Empty on success. */
  customerMessage: string
  /** Provider's transaction id, present on success (and often on decline). */
  pspReference?: string | null
  /** Present only when `status === "requires_3ds"`. */
  threeDSChallenge?: ThreeDSChallenge | null
}
