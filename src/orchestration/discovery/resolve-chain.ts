/**
 * Pure routing: resolve the ordered provider chain for one (cart context,
 * method). This is the single source of truth both discovery (which methods to
 * offer) and a charge (which providers to walk) read from, so the two can never
 * disagree about how a method routes.
 *
 * Stages, in order:
 *   1. Method geo cap — the method's own supported countries/currencies.
 *   2. Match the highest-priority rule whose conditions fit (else the global
 *      fallback rule).
 *   3. From that rule's weights, keep providers that are active AND actually
 *      cover this cart's country/currency/method, pick the primary by a
 *      seed-weighted draw, then build the fallback chain from the rest plus the
 *      rule's fallbackOrder, capped in length.
 *   4. If no PSP is eligible, a method_provider that serves the method binds
 *      directly.
 */
import type { Catalog, Provider, RoutingRule } from "./catalog"
import { seededPercent } from "./seed-hash"

export const DEFAULT_CHAIN_CAP = 3

export interface CartContext {
  country: string
  currency: string
  method: string
  cardNetwork?: string
  cartId: string
}

export interface ResolvedChain {
  primary: string
  fallback: string[]
  ruleName: string
  usedGlobalFallback: boolean
  binding: "psp" | "method_provider"
}

export type ChainFailure =
  | { kind: "method_geo_cap"; detail: string }
  | { kind: "no_rule_matched" }
  | { kind: "no_eligible_providers" }

export type ChainResult = { ok: true; chain: ResolvedChain } | { ok: false; failure: ChainFailure }

const up = (s: string) => s.toUpperCase()

function coversCart(p: Provider, ctx: CartContext): boolean {
  return (
    p.config.countries.map(up).includes(up(ctx.country)) &&
    p.config.currencies.map(up).includes(up(ctx.currency)) &&
    p.config.methods.includes(ctx.method)
  )
}

function condMatch(cond: string[] | undefined, value: string, caseInsensitive: boolean): boolean {
  if (!cond || cond.length === 0) return true // wildcard
  return caseInsensitive ? cond.map(up).includes(up(value)) : cond.includes(value)
}

function ruleMatches(rule: RoutingRule, ctx: CartContext): boolean {
  if (!condMatch(rule.conditions.country, ctx.country, true)) return false
  if (!condMatch(rule.conditions.currency, ctx.currency, true)) return false
  // A network-specific rule only applies once a network is known. At
  // network-agnostic discovery (no card entered) it is skipped, so it can't
  // shadow the geographic rules — the offered-method union stays the same, only
  // a method's chain may change once a network narrows it.
  if (rule.conditions.cardNetwork && rule.conditions.cardNetwork.length > 0) {
    if (!ctx.cardNetwork) return false
    if (!condMatch(rule.conditions.cardNetwork, ctx.cardNetwork, true)) return false
  }
  return true
}

function findRule(rules: RoutingRule[], ctx: CartContext): { rule: RoutingRule; global: boolean } | null {
  const specific = rules
    .filter((r) => !r.isGlobalFallback)
    .filter((r) => ruleMatches(r, ctx))
    .sort((a, b) => a.priority - b.priority)
  const first = specific[0]
  if (first) return { rule: first, global: false }
  const fallback = rules.find((r) => r.isGlobalFallback)
  return fallback ? { rule: fallback, global: true } : null
}

/** Seed-weighted pick from {providerId: weight}. Weights need not sum to 100. */
export function pickByWeight(weights: Record<string, number>, seed: string): string | null {
  const entries = Object.entries(weights).filter(([, w]) => w > 0)
  if (entries.length === 0) return null
  const total = entries.reduce((s, [, w]) => s + w, 0)
  const scaled = (seededPercent(seed) / 100) * total
  let cumulative = 0
  for (const [id, w] of entries) {
    cumulative += w
    if (scaled < cumulative) return id
  }
  const last = entries[entries.length - 1]
  return last ? last[0] : null
}

function without(weights: Record<string, number>, id: string): Record<string, number> {
  const next: Record<string, number> = {}
  for (const [k, v] of Object.entries(weights)) if (k !== id) next[k] = v
  return next
}

function buildFallback(weights: Record<string, number>, seed: string): string[] {
  const chain: string[] = []
  let remaining = { ...weights }
  let attempt = 1
  while (Object.values(remaining).some((w) => w > 0)) {
    const next = pickByWeight(remaining, `${seed}::fallback::${attempt}`)
    if (!next) break
    chain.push(next)
    remaining = without(remaining, next)
    attempt++
  }
  return chain
}

export function resolveProviderChain(
  catalog: Catalog,
  ctx: CartContext,
  maxChain: number = DEFAULT_CHAIN_CAP,
): ChainResult {
  const method = catalog.methods.find((m) => m.code === ctx.method)
  if (!method || method.status !== "active") {
    return { ok: false, failure: { kind: "no_eligible_providers" } }
  }

  // Stage 1: the method's own geo cap.
  if (method.supportedCountries && !method.supportedCountries.map(up).includes(up(ctx.country))) {
    return { ok: false, failure: { kind: "method_geo_cap", detail: ctx.country } }
  }
  if (method.supportedCurrencies && !method.supportedCurrencies.map(up).includes(up(ctx.currency))) {
    return { ok: false, failure: { kind: "method_geo_cap", detail: ctx.currency } }
  }

  const active = catalog.providers.filter((p) => p.status === "active")

  // A method_provider that serves this method binds directly; used as the
  // gap-fill when the rule/PSP path yields nothing.
  const bindMethodProvider = (): ChainResult | null => {
    const mp = active.find((p) => p.kind === "method_provider" && coversCart(p, ctx))
    if (!mp) return null
    return { ok: true, chain: { primary: mp.id, fallback: [], ruleName: "direct binding", usedGlobalFallback: false, binding: "method_provider" } }
  }

  // Stage 2: rule match.
  const match = findRule(catalog.rules, ctx)
  if (!match) return bindMethodProvider() ?? { ok: false, failure: { kind: "no_rule_matched" } }

  const byId = new Map(active.map((p) => [p.id, p] as const))
  const eligible = (id: string): boolean => {
    const p = byId.get(id)
    return !!p && p.kind === "psp" && coversCart(p, ctx)
  }

  // Keep rule weights to providers that are active psps covering this cart.
  const usable: Record<string, number> = {}
  for (const [id, w] of Object.entries(match.rule.weights)) {
    if (w > 0 && eligible(id)) usable[id] = w
  }

  const eligibleFallbackOrder = match.rule.fallbackOrder.filter((id) => !(id in usable)).filter(eligible)

  let primary = Object.keys(usable).length > 0 ? pickByWeight(usable, ctx.cartId) : null
  if (!primary) {
    primary = eligibleFallbackOrder.shift() ?? null
    if (!primary) return bindMethodProvider() ?? { ok: false, failure: { kind: "no_eligible_providers" } }
  }

  const weightedFallback = buildFallback(without(usable, primary), ctx.cartId)
  const untrimmed = [...weightedFallback, ...eligibleFallbackOrder.filter((id) => id !== primary)]
  const fallback = untrimmed.slice(0, Math.max(0, maxChain - 1))

  return {
    ok: true,
    chain: { primary, fallback, ruleName: match.rule.name, usedGlobalFallback: match.global, binding: "psp" },
  }
}
