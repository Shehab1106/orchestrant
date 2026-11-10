import { describe, it, expect } from "vitest"
import { SEED_CATALOG, cloneCatalog } from "../src/orchestration/discovery/catalog"
import { resolveProviderChain } from "../src/orchestration/discovery/resolve-chain"
import { resolveOfferedMethods } from "../src/orchestration/discovery/resolve-offered"

const CART = "preview-cart"

describe("resolveProviderChain", () => {
  it("routes an AE/AED card charge through the UAE split rule", () => {
    const r = resolveProviderChain(SEED_CATALOG, { country: "AE", currency: "AED", method: "card", cartId: CART })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chain.ruleName).toBe("UAE split")
    // Both northwind and meridian are eligible; primary + the other as fallback.
    expect([r.chain.primary, ...r.chain.fallback].sort()).toEqual(["meridian", "northwind"])
    expect(r.chain.usedGlobalFallback).toBe(false)
  })

  it("falls back to the global rule when no specific rule matches", () => {
    const r = resolveProviderChain(SEED_CATALOG, { country: "US", currency: "USD", method: "card", cartId: CART })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chain.usedGlobalFallback).toBe(true)
    expect(r.chain.ruleName).toBe("Global fallback")
  })

  it("applies the amex network rule only when a card network is supplied", () => {
    const withNet = resolveProviderChain(SEED_CATALOG, { country: "US", currency: "USD", method: "card", cardNetwork: "amex", cartId: CART })
    expect(withNet.ok).toBe(true)
    if (!withNet.ok) return
    expect(withNet.chain.ruleName).toBe("Amex to Meridian")
    expect(withNet.chain.primary).toBe("meridian")
    expect(withNet.chain.fallback).toContain("northwind")
  })

  it("binds a method_provider directly when no psp serves the method", () => {
    const r = resolveProviderChain(SEED_CATALOG, { country: "AE", currency: "AED", method: "paylater", cartId: CART })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.chain.binding).toBe("method_provider")
    expect(r.chain.primary).toBe("latitude")
  })

  it("is deterministic for the same seed", () => {
    const a = resolveProviderChain(SEED_CATALOG, { country: "AE", currency: "AED", method: "card", cartId: "cart_x" })
    const b = resolveProviderChain(SEED_CATALOG, { country: "AE", currency: "AED", method: "card", cartId: "cart_x" })
    expect(a).toEqual(b)
  })
})

describe("resolveOfferedMethods (union)", () => {
  it("offers the methods a UAE/AED cart supports and explains the rest", () => {
    const { offered, notOffered } = resolveOfferedMethods(SEED_CATALOG, { country: "AE", currency: "AED", cartId: CART })
    expect(offered.map((m) => m.code).sort()).toEqual(["bank_transfer", "card", "paylater", "wallet"])
  })

  it("drops a method blocked by its own geo cap", () => {
    const { offered, notOffered } = resolveOfferedMethods(SEED_CATALOG, { country: "US", currency: "USD", cartId: CART })
    expect(offered.map((m) => m.code).sort()).toEqual(["card", "wallet"])
    // bank_transfer (AE/GB/DE only) and paylater (AE only) are geo-capped out of the US.
    expect(notOffered.map((m) => m.code).sort()).toEqual(["bank_transfer", "paylater"])
  })

  it("reflects a disabled provider on re-resolve", () => {
    const edited = cloneCatalog(SEED_CATALOG)
    edited.providers.find((p) => p.id === "latitude")!.status = "disabled"
    const { offered } = resolveOfferedMethods(edited, { country: "AE", currency: "AED", cartId: CART })
    // With Latitude off, paylater has no provider and drops out.
    expect(offered.map((m) => m.code)).not.toContain("paylater")
  })
})
