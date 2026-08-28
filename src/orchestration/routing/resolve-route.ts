/**
 * Routing resolver — turns a set of rules + a charge context into the ORDERED
 * list of provider ids the cascade should try.
 *
 * A rule matches on country / currency / card network. The matched rule's
 * `weights` decide the primary order (highest weight first — a deterministic
 * stand-in for weighted-random selection, which a real deployment seeds per
 * charge), then `fallbackOrder` is appended. Duplicates are removed, first
 * occurrence wins.
 */
import type { CardNetwork } from "../types"

export interface RoutingRule {
  /** Lower number = evaluated first. First match wins. */
  priority: number
  conditions: {
    country?: string[]
    currency?: string[]
    network?: CardNetwork[]
  }
  /** providerId -> weight. Higher = tried earlier among primaries. */
  weights: Record<string, number>
  /** Providers appended after the weighted primaries. */
  fallbackOrder: string[]
}

export interface RouteContext {
  country?: string
  currency: string
  network?: CardNetwork
}

export function resolveRoute(rules: readonly RoutingRule[], ctx: RouteContext): string[] {
  const match = [...rules]
    .sort((a, b) => a.priority - b.priority)
    .find((r) => conditionsMatch(r.conditions, ctx))

  if (!match) return []

  const primaries = Object.entries(match.weights)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([providerId]) => providerId)

  return dedupe([...primaries, ...match.fallbackOrder])
}

function conditionsMatch(conditions: RoutingRule["conditions"], ctx: RouteContext): boolean {
  if (conditions.currency && !conditions.currency.includes(ctx.currency)) return false
  if (conditions.country && (ctx.country == null || !conditions.country.includes(ctx.country))) {
    return false
  }
  if (conditions.network && (ctx.network == null || !conditions.network.includes(ctx.network))) {
    return false
  }
  return true
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}
