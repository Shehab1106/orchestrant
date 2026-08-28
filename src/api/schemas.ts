/**
 * Request validation for the HTTP layer. The inferred types are structurally
 * compatible with the engine's ChargeInput / RefundInput, so a validated body
 * flows straight into the service without casts.
 */
import { z } from "zod"

export const cardSchema = z.object({
  token: z.string().min(1),
  network: z.enum(["visa", "mastercard", "amex", "discover", "unknown"]).optional(),
  last4: z.string().optional(),
})

export const threeDSProofSchema = z.object({
  cavv: z.string(),
  eci: z.string(),
  dsTransactionId: z.string(),
  version: z.string(),
})

export const chargeSchema = z.object({
  idempotencyKey: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  card: cardSchema,
  country: z.string().length(2).optional(),
  threeDSProof: threeDSProofSchema.nullable().optional(),
})
export type ChargeBody = z.infer<typeof chargeSchema>

export const refundSchema = z.object({
  providerId: z.string().min(1),
  pspReference: z.string().min(1),
  amount: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
})
export type RefundBody = z.infer<typeof refundSchema>

export const voidSchema = z.object({
  providerId: z.string().min(1),
  pspReference: z.string().min(1),
})
export type VoidBody = z.infer<typeof voidSchema>
