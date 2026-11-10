/**
 * The orchestration configuration: the providers, the payment methods, and the
 * routing rules the resolver reads. In a real deployment these are database
 * tables an operator edits; here they are an invented, self-contained seed so
 * the engine runs with zero setup.
 *
 * This is a clean-room reference model of a payment-orchestration config. The
 * provider names, methods, and rules are illustrative inventions — not any real
 * payment system's data.
 */

export type ProviderKind = "psp" | "method_provider"
export type Status = "active" | "disabled"

/** What a provider can actually transact: the intersection a cart must fall in. */
export interface ProviderConfig {
  countries: string[]
  currencies: string[]
  methods: string[]
}

export interface Provider {
  id: string
  name: string
  /** `psp` = routed through rule weights; `method_provider` = binds its method directly. */
  kind: ProviderKind
  status: Status
  config: ProviderConfig
}

export interface PaymentMethod {
  code: string
  label: string
  /** null = unrestricted. The method's OWN geo cap, independent of provider coverage. */
  supportedCountries: string[] | null
  supportedCurrencies: string[] | null
  status: Status
}

export interface RoutingRule {
  id: string
  name: string
  /** Lower number is evaluated first; first specific match wins. */
  priority: number
  /** Omitted field = wildcard (matches any cart value). */
  conditions: {
    country?: string[]
    currency?: string[]
    cardNetwork?: string[]
  }
  /** providerId -> weight. Higher = more likely to be the primary. */
  weights: Record<string, number>
  /** Providers appended after the weighted set, in order. */
  fallbackOrder: string[]
  /** Exactly one rule should carry this: the catch-all when no specific rule matches. */
  isGlobalFallback: boolean
}

export interface Catalog {
  providers: Provider[]
  methods: PaymentMethod[]
  rules: RoutingRule[]
}

/** Deep clone so the editable UI can mutate a copy without touching the seed. */
export function cloneCatalog(c: Catalog): Catalog {
  return {
    providers: c.providers.map((p) => ({ ...p, config: { ...p.config, countries: [...p.config.countries], currencies: [...p.config.currencies], methods: [...p.config.methods] } })),
    methods: c.methods.map((m) => ({ ...m, supportedCountries: m.supportedCountries ? [...m.supportedCountries] : null, supportedCurrencies: m.supportedCurrencies ? [...m.supportedCurrencies] : null })),
    rules: c.rules.map((r) => ({ ...r, conditions: { ...r.conditions }, weights: { ...r.weights }, fallbackOrder: [...r.fallbackOrder] })),
  }
}

export const COUNTRIES = ["AE", "US", "GB", "DE"] as const
export const CURRENCIES = ["AED", "USD", "GBP", "EUR"] as const
export const CARD_NETWORKS = ["visa", "mastercard", "amex"] as const

export const SEED_CATALOG: Catalog = {
  providers: [
    {
      id: "northwind",
      name: "Northwind",
      kind: "psp",
      status: "active",
      config: { countries: ["AE", "US", "GB", "DE"], currencies: ["AED", "USD", "GBP", "EUR"], methods: ["card", "wallet", "bank_transfer"] },
    },
    {
      id: "cedar",
      name: "Cedar",
      kind: "psp",
      status: "active",
      config: { countries: ["US", "GB", "DE"], currencies: ["USD", "GBP", "EUR"], methods: ["card", "wallet"] },
    },
    {
      id: "meridian",
      name: "Meridian",
      kind: "psp",
      status: "active",
      config: { countries: ["AE", "US"], currencies: ["AED", "USD"], methods: ["card", "bank_transfer"] },
    },
    {
      id: "latitude",
      name: "Latitude",
      kind: "method_provider",
      status: "active",
      config: { countries: ["AE"], currencies: ["AED"], methods: ["paylater"] },
    },
  ],
  methods: [
    { code: "card", label: "Card", supportedCountries: null, supportedCurrencies: null, status: "active" },
    { code: "wallet", label: "Wallet", supportedCountries: ["US", "GB", "AE"], supportedCurrencies: null, status: "active" },
    { code: "bank_transfer", label: "Bank transfer", supportedCountries: ["AE", "GB", "DE"], supportedCurrencies: ["AED", "GBP", "EUR"], status: "active" },
    { code: "paylater", label: "Pay later", supportedCountries: ["AE"], supportedCurrencies: ["AED"], status: "active" },
  ],
  rules: [
    {
      id: "rule_amex",
      name: "Amex to Meridian",
      priority: 1,
      conditions: { cardNetwork: ["amex"] },
      weights: { meridian: 100 },
      fallbackOrder: ["northwind"],
      isGlobalFallback: false,
    },
    {
      id: "rule_ae",
      name: "UAE split",
      priority: 2,
      conditions: { country: ["AE"], currency: ["AED"] },
      weights: { northwind: 60, meridian: 40 },
      fallbackOrder: [],
      isGlobalFallback: false,
    },
    {
      id: "rule_global",
      name: "Global fallback",
      priority: 99,
      conditions: {},
      weights: { northwind: 50, cedar: 50 },
      fallbackOrder: [],
      isGlobalFallback: true,
    },
  ],
}
