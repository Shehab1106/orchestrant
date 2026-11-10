/**
 * Per-method discovery union: which methods would this cart be offered, and how
 * does each route. For every active method, it runs the SAME resolveProviderChain
 * a charge uses; a method is offered iff a chargeable chain comes back. The
 * offered methods, each carrying its resolved chain, are what a checkout shows —
 * methods from different providers unioned onto one screen.
 */
import type { Catalog } from "./catalog"
import { resolveProviderChain, type ResolvedChain, type CartContext, DEFAULT_CHAIN_CAP } from "./resolve-chain"

export interface OfferedMethod {
  code: string
  label: string
  kind: "psp" | "method_provider"
  chain: ResolvedChain
}

export interface NotOffered {
  code: string
  label: string
  reason: string
}

export interface Resolution {
  offered: OfferedMethod[]
  notOffered: NotOffered[]
}

export interface DiscoveryContext {
  country: string
  currency: string
  cardNetwork?: string
  cartId: string
}

function reasonText(failure: { kind: string; detail?: string }): string {
  switch (failure.kind) {
    case "method_geo_cap":
      return `method isn't offered in ${failure.detail}`
    case "no_rule_matched":
      return "no routing rule matched this cart"
    case "no_eligible_providers":
      return "no provider covers this cart"
    default:
      return "not eligible"
  }
}

export function resolveOfferedMethods(
  catalog: Catalog,
  ctx: DiscoveryContext,
  maxChain: number = DEFAULT_CHAIN_CAP,
): Resolution {
  const offered: OfferedMethod[] = []
  const notOffered: NotOffered[] = []

  for (const method of catalog.methods) {
    if (method.status !== "active") {
      notOffered.push({ code: method.code, label: method.label, reason: "method disabled" })
      continue
    }
    const cart: CartContext = {
      country: ctx.country,
      currency: ctx.currency,
      method: method.code,
      cardNetwork: ctx.cardNetwork,
      cartId: ctx.cartId,
    }
    const result = resolveProviderChain(catalog, cart, maxChain)
    if (result.ok) {
      offered.push({ code: method.code, label: method.label, kind: result.chain.binding, chain: result.chain })
    } else {
      notOffered.push({ code: method.code, label: method.label, reason: reasonText(result.failure) })
    }
  }

  return { offered, notOffered }
}
