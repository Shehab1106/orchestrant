/**
 * Property-based tests for the routing engine. Instead of a few hand-picked
 * carts, these assert invariants hold across hundreds of randomized ones.
 *
 * The one that matters most: a method is never OFFERED with a chain that can't
 * actually serve the cart. That "discovery can't drift from what charges" is the
 * whole point of running the same resolver on both paths, so it's worth proving
 * over the input space, not one example.
 */
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { SEED_CATALOG, COUNTRIES, CURRENCIES, CARD_NETWORKS, type Provider } from "../src/orchestration/discovery/catalog"
import { resolveOfferedMethods } from "../src/orchestration/discovery/resolve-offered"
import { resolveProviderChain, pickByWeight } from "../src/orchestration/discovery/resolve-chain"

const up = (s: string) => s.toUpperCase()
function covers(p: Provider, country: string, currency: string, method: string): boolean {
  return (
    p.config.countries.map(up).includes(up(country)) &&
    p.config.currencies.map(up).includes(up(currency)) &&
    p.config.methods.includes(method)
  )
}

const cartArb = fc.record({
  country: fc.constantFrom(...COUNTRIES),
  currency: fc.constantFrom(...CURRENCIES),
  cardNetwork: fc.option(fc.constantFrom(...CARD_NETWORKS), { nil: undefined }),
  cartId: fc.string({ minLength: 1, maxLength: 12 }),
})

describe("routing engine properties", () => {
  it("is deterministic for a given cart and seed", () => {
    fc.assert(
      fc.property(cartArb, (ctx) => {
        expect(resolveOfferedMethods(SEED_CATALOG, ctx)).toEqual(resolveOfferedMethods(SEED_CATALOG, ctx))
      }),
    )
  })

  it("never offers a method whose chain can't serve the cart (no shown-but-not-chargeable drift)", () => {
    fc.assert(
      fc.property(cartArb, (ctx) => {
        const { offered } = resolveOfferedMethods(SEED_CATALOG, ctx)
        for (const m of offered) {
          for (const id of [m.chain.primary, ...m.chain.fallback]) {
            const p = SEED_CATALOG.providers.find((x) => x.id === id)
            expect(p).toBeDefined()
            expect(p!.status).toBe("active")
            expect(covers(p!, ctx.country, ctx.currency, m.code)).toBe(true)
          }
        }
      }),
    )
  })

  it("an offered method always re-resolves to a chargeable chain for the same cart", () => {
    fc.assert(
      fc.property(cartArb, (ctx) => {
        const { offered } = resolveOfferedMethods(SEED_CATALOG, ctx)
        for (const m of offered) {
          expect(resolveProviderChain(SEED_CATALOG, { ...ctx, method: m.code }).ok).toBe(true)
        }
      }),
    )
  })

  it("pickByWeight returns a positively-weighted id deterministically, or null when none has weight", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: 100 })),
        fc.string({ minLength: 1, maxLength: 12 }),
        (weights, seed) => {
          const r = pickByWeight(weights, seed)
          const hasPositive = Object.values(weights).some((w) => w > 0)
          if (!hasPositive) {
            expect(r).toBeNull()
          } else {
            expect(r).not.toBeNull()
            expect(weights[r as string]).toBeGreaterThan(0)
            expect(pickByWeight(weights, seed)).toBe(r)
          }
        },
      ),
    )
  })
})
