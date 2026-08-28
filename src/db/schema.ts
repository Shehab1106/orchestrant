/**
 * Drizzle schema. JSONB columns are `$type`-annotated with the domain shapes
 * they store, so reads come back typed without casts.
 */
import { pgTable, serial, text, integer, jsonb, boolean, timestamp } from "drizzle-orm/pg-core"
import type { RoutingRule } from "../orchestration/routing/resolve-route"
import type { ChargeResult } from "../orchestration/types"
import type { StoredResult } from "../orchestration/ports"

export const paymentAttempt = pgTable("payment_attempt", {
  id: serial("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull(),
  providerId: text("provider_id").notNull(),
  status: text("status").notNull(),
  errorCategory: text("error_category").notNull(),
  errorCode: text("error_code"),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  pspReference: text("psp_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const routingRule = pgTable("routing_rule", {
  id: serial("id").primaryKey(),
  priority: integer("priority").notNull(),
  conditions: jsonb("conditions").$type<RoutingRule["conditions"]>().notNull(),
  weights: jsonb("weights").$type<Record<string, number>>().notNull(),
  fallbackOrder: jsonb("fallback_order").$type<string[]>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
})

export const idempotencyRecord = pgTable("idempotency_record", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  finalStatus: text("final_status").$type<StoredResult["finalStatus"]>().notNull(),
  finalResult: jsonb("final_result").$type<ChargeResult>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
