"use client"

import { useMemo, useRef, useState } from "react"
import {
  SEED_CATALOG,
  cloneCatalog,
  COUNTRIES,
  CURRENCIES,
  CARD_NETWORKS,
  type Catalog,
} from "../src/orchestration/discovery/catalog"
import { resolveOfferedMethods, type OfferedMethod } from "../src/orchestration/discovery/resolve-offered"
import { executeChargeChain, type AttemptRecord } from "../src/orchestration/cascade/execute-charge-chain"
import { MockGateway } from "../src/orchestration/adapters/mock-gateway.adapter"
import type { ChargeResult } from "../src/orchestration/types"

type Scenario = "approve" | "cascade" | "threeds" | "hard"
const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "approve", label: "Primary approves" },
  { id: "cascade", label: "Primary soft-declines → cascade" },
  { id: "threeds", label: "3-D Secure, then approves" },
  { id: "hard", label: "Hard decline → chain stops" },
]
const ANY = "__any__"
const SYMBOL: Record<string, string> = { AED: "AED ", USD: "$", GBP: "£", EUR: "€" }

function kindOf(status: string): "success" | "soft" | "hard" | "info" {
  if (status === "success") return "success"
  if (status === "soft_fail" || status === "timeout") return "soft"
  if (status === "requires_3ds") return "info"
  return "hard"
}

// Build a chain of configured mocks for a scenario over the resolved providers.
function buildGateways(chain: string[], scenario: Scenario): { gateways: MockGateway[]; token: string } {
  const token = scenario === "hard" ? "invalid_card" : "tok_ok"
  const gateways = chain.map((id, i) => {
    if (i === 0 && scenario === "cascade") return new MockGateway({ providerId: id, alwaysSoftFail: true })
    if (i === 0 && scenario === "threeds") return new MockGateway({ providerId: id, requires3ds: true })
    return new MockGateway({ providerId: id })
  })
  return { gateways, token }
}

type ChargeState = {
  method: OfferedMethod
  scenario: Scenario
  phase: "form" | "threeds" | "done"
  finalStatus?: "success" | "failed" | "requires_3ds"
  finalResult?: ChargeResult
  attempts: AttemptRecord[]
  replayed: boolean
}

export default function Orchestrant() {
  const [catalog, setCatalog] = useState<Catalog>(() => cloneCatalog(SEED_CATALOG))
  const [country, setCountry] = useState<string>("AE")
  const [currency, setCurrency] = useState<string>("AED")
  const [network, setNetwork] = useState<string>(ANY)
  const [amount, setAmount] = useState("50.00")
  const [cartId, setCartId] = useState("preview-cart")

  const [charge, setCharge] = useState<ChargeState | null>(null)
  const [busy, setBusy] = useState(false)
  // Idempotency store, keyed like the real one: a terminal outcome is stored and
  // replayed; a 3-DS pause is not.
  const idemStore = useRef<Map<string, { finalStatus: ChargeState["finalStatus"]; finalResult?: ChargeResult }>>(new Map())
  const chargeIdem = useRef<string>("")

  const resolution = useMemo(
    () =>
      resolveOfferedMethods(catalog, {
        country,
        currency,
        cardNetwork: network === ANY ? undefined : network,
        cartId,
      }),
    [catalog, country, currency, network, cartId],
  )

  const sym = SYMBOL[currency] ?? "$"
  const amountMinor = () => {
    const n = Number.parseFloat(amount)
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
  }

  // --- config editing -------------------------------------------------------
  function toggleProvider(id: string) {
    setCatalog((c) => {
      const next = cloneCatalog(c)
      const p = next.providers.find((x) => x.id === id)
      if (p) p.status = p.status === "active" ? "disabled" : "active"
      return next
    })
  }
  function toggleMethod(code: string) {
    setCatalog((c) => {
      const next = cloneCatalog(c)
      const m = next.methods.find((x) => x.code === code)
      if (m) m.status = m.status === "active" ? "disabled" : "active"
      return next
    })
  }
  // Toggle one value in a provider's coverage array. This is the config the
  // union actually reads: a provider is kept for a cart only if it covers the
  // cart's country, currency, and method (see resolveProviderChain's coversCart).
  function toggleCoverage(providerId: string, dim: "countries" | "currencies" | "methods", value: string) {
    setCatalog((c) => {
      const next = cloneCatalog(c)
      const p = next.providers.find((x) => x.id === providerId)
      if (!p) return next
      const arr = p.config[dim]
      const i = arr.indexOf(value)
      if (i >= 0) arr.splice(i, 1)
      else arr.push(value)
      return next
    })
  }
  // A method provider IS a single method (Tabby = pay-later): its methods set is
  // exactly one, so the picker is radio, not multi-select. Picking another moves
  // the binding; you can never reach zero or many.
  function setSoleMethod(providerId: string, value: string) {
    setCatalog((c) => {
      const next = cloneCatalog(c)
      const p = next.providers.find((x) => x.id === providerId)
      if (p) p.config.methods = [value]
      return next
    })
  }
  function setWeight(ruleId: string, providerId: string, value: string) {
    const w = Math.max(0, Math.round(Number.parseFloat(value) || 0))
    setCatalog((c) => {
      const next = cloneCatalog(c)
      const r = next.rules.find((x) => x.id === ruleId)
      if (r) r.weights[providerId] = w
      return next
    })
  }
  function resetConfig() {
    setCatalog(cloneCatalog(SEED_CATALOG))
  }

  // --- charge drilldown -----------------------------------------------------
  function openCharge(method: OfferedMethod) {
    setCharge({ method, scenario: "cascade", phase: "form", attempts: [], replayed: false })
  }
  function closeCharge() {
    setCharge(null)
  }
  function chainOf(m: OfferedMethod): string[] {
    return [m.chain.primary, ...m.chain.fallback]
  }

  async function runCharge(replay = false) {
    if (!charge) return
    const minor = amountMinor()
    if (minor <= 0) return
    setBusy(true)
    const chain = chainOf(charge.method)
    const idem = replay ? chargeIdem.current : crypto.randomUUID()
    if (!replay) chargeIdem.current = idem

    const prior = idemStore.current.get(idem)
    if (prior) {
      setCharge({ ...charge, phase: "done", finalStatus: prior.finalStatus, finalResult: prior.finalResult, attempts: [], replayed: true })
      setBusy(false)
      return
    }

    const { gateways, token } = buildGateways(chain, charge.scenario)
    const out = await executeChargeChain(gateways, {
      idempotencyKey: idem,
      amount: minor,
      currency,
      country,
      card: { token, network: network === ANY ? "visa" : (network as "visa") },
      threeDSProof: null,
    })
    if (out.finalStatus !== "requires_3ds") {
      idemStore.current.set(idem, { finalStatus: out.finalStatus, finalResult: out.finalResult })
    }
    setCharge({
      ...charge,
      phase: out.finalStatus === "requires_3ds" ? "threeds" : "done",
      finalStatus: out.finalStatus,
      finalResult: out.finalResult,
      attempts: out.attempts,
      replayed: false,
    })
    setBusy(false)
  }

  async function completeChallenge() {
    if (!charge) return
    setBusy(true)
    const chain = chainOf(charge.method)
    const { gateways, token } = buildGateways(chain, charge.scenario)
    const out = await executeChargeChain(gateways, {
      idempotencyKey: chargeIdem.current,
      amount: amountMinor(),
      currency,
      country,
      card: { token, network: network === ANY ? "visa" : (network as "visa") },
      threeDSProof: { cavv: "mock-cavv", eci: "05", dsTransactionId: crypto.randomUUID(), version: "2.2.0" },
    })
    idemStore.current.set(chargeIdem.current, { finalStatus: out.finalStatus, finalResult: out.finalResult })
    setCharge({ ...charge, phase: "done", finalStatus: out.finalStatus, finalResult: out.finalResult, attempts: out.attempts, replayed: false })
    setBusy(false)
  }

  function setScenario(s: Scenario) {
    if (!charge) return
    setCharge({ ...charge, scenario: s, phase: "form", attempts: [], replayed: false, finalStatus: undefined, finalResult: undefined })
  }

  const providerName = (id: string) => catalog.providers.find((p) => p.id === id)?.name ?? id

  return (
    <main className="wrap">
      <div className="top">
        <div className="brand">
          <span className="glyph" aria-hidden />
          <div>
            <h1><span className="mono">orchestrant</span></h1>
            <div className="sub">routing console</div>
          </div>
          <span className="chip" style={{ marginLeft: 8 }}>test mode</span>
        </div>
        <div className="top-links">
          <a href="https://github.com/Shehab1106/orchestrant" target="_blank" rel="noopener noreferrer">Source on GitHub</a>
          <a href="https://github.com/Shehab1106/orchestrant#readme" target="_blank" rel="noopener noreferrer">How it works</a>
        </div>
      </div>

      <p className="lede">
        Set a cart context and the engine runs <b>per-method discovery</b>: for every payment method it
        resolves a provider chain from the routing rules, and offers the method only if a chargeable chain
        comes back — so methods from different providers <b>union</b> onto one checkout. Edit the config on
        the left and the offered set updates live. Charge a method to watch its chain <b>cascade</b>.
      </p>

      <div className="grid">
        <aside>
          <div className="panel-card form">
            <h2>Cart context</h2>
            <div className="duo">
              <label className="field">
                <span className="lbl">Country</span>
                <div className="control select-control">
                  <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </label>
              <label className="field">
                <span className="lbl">Currency</span>
                <div className="control select-control">
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </label>
            </div>
            <label className="field">
              <span className="lbl">Card network <span className="opt">(narrows card routing)</span></span>
              <div className="control select-control">
                <select value={network} onChange={(e) => setNetwork(e.target.value)} aria-label="Card network">
                  <option value={ANY}>Any network</option>
                  {CARD_NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </label>
            <div className="duo">
              <label className="field">
                <span className="lbl">Amount</span>
                <div className="control"><span className="prefix">{sym}</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Amount" />
                </div>
              </label>
              <label className="field">
                <span className="lbl">Cart seed <span className="opt">(sticky pick)</span></span>
                <div className="control">
                  <input value={cartId} onChange={(e) => setCartId(e.target.value)} aria-label="Cart seed" className="mono-in" />
                </div>
              </label>
            </div>
          </div>

          <div className="panel-card">
            <h2>Config <button className="link-btn" onClick={resetConfig}>reset</button></h2>

            <div className="cfg-group">
              <div className="cfg-label">Providers <span className="cfg-hint">coverage the cart must fall inside</span></div>
              {catalog.providers.map((p) => (
                <div className={`prov-box ${p.status === "active" ? "on" : "off"}`} key={p.id}>
                  <button
                    className="prov-head"
                    onClick={() => toggleProvider(p.id)}
                    aria-pressed={p.status === "active"}
                    title={p.status === "active" ? "disable provider" : "enable provider"}
                  >
                    <span className="dot" />
                    <span className="cfg-name mono">{p.id}</span>
                    <span className={`kindtag ${p.kind}`}>{p.kind === "psp" ? "PSP" : "method provider"}</span>
                  </button>
                  <div className="cov">
                    <CovRow label="countries" universe={COUNTRIES} active={p.config.countries} onToggle={(v) => toggleCoverage(p.id, "countries", v)} />
                    <CovRow label="currencies" universe={CURRENCIES} active={p.config.currencies} onToggle={(v) => toggleCoverage(p.id, "currencies", v)} />
                    {p.kind === "method_provider" ? (
                      <CovRow label="method" hint="binds one" universe={catalog.methods.map((m) => m.code)} active={p.config.methods} onToggle={(v) => setSoleMethod(p.id, v)} single />
                    ) : (
                      <CovRow label="methods" universe={catalog.methods.map((m) => m.code)} active={p.config.methods} onToggle={(v) => toggleCoverage(p.id, "methods", v)} />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="cfg-group">
              <div className="cfg-label">Methods</div>
              {catalog.methods.map((m) => (
                <button
                  key={m.code}
                  className={`cfg-item ${m.status === "active" ? "on" : "off"}`}
                  onClick={() => toggleMethod(m.code)}
                  aria-pressed={m.status === "active"}
                >
                  <span className="dot" />
                  <span className="cfg-name mono">{m.code}</span>
                  <span className="cfg-note">
                    {m.supportedCountries || m.supportedCurrencies
                      ? [m.supportedCountries?.join("/"), m.supportedCurrencies?.join("/")].filter(Boolean).join(" · ")
                      : "any geo"}
                  </span>
                </button>
              ))}
            </div>

            <div className="cfg-group">
              <div className="cfg-label">Routing rules</div>
              {catalog.rules.map((r) => (
                <div className="rule-box" key={r.id}>
                  <div className="rule-top">
                    <span className="rule-name">{r.name}</span>
                    {r.isGlobalFallback && <span className="gf">global fallback</span>}
                  </div>
                  <div className="rule-cond mono">
                    {Object.entries(r.conditions).length === 0
                      ? "any cart"
                      : Object.entries(r.conditions).map(([k, v]) => `${k}=${(v as string[]).join("/")}`).join(", ")}
                  </div>
                  <div className="wt-row">
                    {catalog.providers.filter((p) => p.kind === "psp").map((p) => (
                      <label className="wt" key={p.id} title={`${p.id} weight`}>
                        <span className="mono">{p.id}</span>
                        <input
                          type="number"
                          min={0}
                          value={r.weights[p.id] ?? 0}
                          onChange={(e) => setWeight(r.id, p.id, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="stage">
          {!charge && (
            <>
              <div className="stage-head">
                <h2>Offered methods</h2>
                <span className="seq">
                  {resolution.offered.length} offered · {country}/{currency}{network !== ANY ? ` · ${network}` : ""}
                </span>
              </div>

              {resolution.offered.length === 0 && (
                <div className="stage-idle">
                  <p>No method resolves a chargeable chain for this cart. Loosen the config or change the context.</p>
                </div>
              )}

              <div className="methods">
                {resolution.offered.map((m, i) => (
                  <button className="method" key={m.code} onClick={() => openCharge(m)} style={{ animationDelay: `${i * 70}ms` }}>
                    <div className="m-top">
                      <span className="m-name">{m.label}</span>
                      <span className={`kindbadge ${m.kind}`}>{m.kind === "psp" ? "routed" : "direct"}</span>
                    </div>
                    <div className="chain">
                      {[m.chain.primary, ...m.chain.fallback].map((id, j) => (
                        <span key={id} style={{ display: "contents" }}>
                          {j > 0 && <span className="arrow" aria-hidden>→</span>}
                          <span className={`node-chip ${j === 0 ? "primary" : ""}`}>{providerName(id)}</span>
                        </span>
                      ))}
                      <span className="rule-tag">{m.chain.ruleName}{m.chain.usedGlobalFallback ? " · fallback" : ""}</span>
                    </div>
                    <span className="charge-hint">charge →</span>
                  </button>
                ))}
              </div>

              {resolution.notOffered.length > 0 && (
                <div className="not-offered">
                  <div className="no-label">not offered</div>
                  {resolution.notOffered.map((m) => (
                    <div className="no-row" key={m.code}>
                      <span className="mono">{m.code}</span>
                      <span className="no-reason">{m.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {charge && (
            <>
              <div className="stage-head">
                <h2><button className="back" onClick={closeCharge} aria-label="Back to offered methods">←</button> Charge · {charge.method.label}</h2>
                <span className="seq">{chainOf(charge.method).map(providerName).join(" → ")}</span>
              </div>

              {charge.phase === "form" && (
                <div className="charge-form">
                  <div className="cf-chain">
                    Routes through {chainOf(charge.method).map((id, j) => (
                      <span key={id} style={{ display: "contents" }}>
                        {j > 0 && <span className="arrow" aria-hidden>→</span>}
                        <span className={`node-chip ${j === 0 ? "primary" : ""}`}>{providerName(id)}</span>
                      </span>
                    ))} under <b>{charge.method.chain.ruleName}</b>.
                  </div>
                  <div className="cf-label">Simulate</div>
                  <div className="scenarios">
                    {SCENARIOS.map((s) => (
                      <button key={s.id} className={`scn ${charge.scenario === s.id ? "on" : ""}`} onClick={() => setScenario(s.id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <button className="btn btn-primary" onClick={() => runCharge(false)} disabled={busy}>
                    {busy ? <><span className="spin" aria-hidden />Routing</> : `Charge ${sym}${amount}`}
                  </button>
                </div>
              )}

              {charge.phase === "threeds" && (
                <div className="threeds">
                  <div className="lock" aria-hidden><LockIcon /></div>
                  <h3>3-D Secure</h3>
                  <p><b className="mono" style={{ color: "var(--info-dk)" }}>{charge.finalResult?.providerId}</b> handed the charge back for cardholder authentication before it will authorize.</p>
                  <button className="btn btn-primary" onClick={completeChallenge} disabled={busy}>
                    {busy ? <><span className="spin" aria-hidden />Authenticating</> : "Complete authentication"}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setScenario(charge.scenario)} disabled={busy}>Cancel</button>
                </div>
              )}

              {charge.phase === "done" && (
                <>
                  <ChargeVerdict charge={charge} providerName={providerName} />
                  {charge.attempts.length > 0 && (
                    <div className="flow">
                      {chainOf(charge.method).map((pid, i) => {
                        const attempt = charge.attempts.find((a) => a.providerId === pid)
                        if (!attempt) {
                          return (
                            <div className="hop skip" key={pid} style={{ animationDelay: `${i * 90}ms` }}>
                              <div className="rail"><span className="node node-skip" /></div>
                              <div className="body"><div className="hop-top"><span className="who">{providerName(pid)}</span><span className="pill pill-skip">not reached</span></div></div>
                            </div>
                          )
                        }
                        const k = kindOf(attempt.result.status)
                        return (
                          <div className="hop" key={pid} style={{ animationDelay: `${i * 110}ms` }}>
                            <div className="rail"><span className={`node node-${k}`} /></div>
                            <div className="body">
                              <div className="hop-top"><span className="who">{providerName(pid)}</span><span className={`pill pill-${k}`}>{attempt.result.status}</span></div>
                              <div className="meta">
                                <span>{attempt.result.errorCategory}{attempt.result.errorCode ? ` · ${attempt.result.errorCode}` : ""}</span>
                                {attempt.result.pspReference && <span className="psp">{attempt.result.pspReference}</span>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {charge.replayed && (
                    <p className="foot-note">Served from the idempotency store: the stored outcome came back without contacting a provider, so replaying can never double-charge.</p>
                  )}
                  <div className="btn-row">
                    <button className="btn btn-line" onClick={() => runCharge(true)} disabled={busy}>Replay same request</button>
                    <button className="btn btn-primary" onClick={() => setScenario(charge.scenario)} disabled={busy}>Charge again</button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  )
}

function ChargeVerdict({ charge, providerName }: { charge: ChargeState; providerName: (id: string) => string }) {
  const replay = charge.replayed ? <span className="replay-tag">replayed</span> : null
  if (charge.finalStatus === "success") {
    return (
      <div className="verdict v-success">
        <span className="vicon"><TickIcon /></span>
        <div>
          <div className="vmain">Payment approved{replay}</div>
          <div className="vsub">Authorized by <b>{providerName(charge.finalResult?.providerId ?? "")}</b>{charge.attempts.length > 0 ? ` after ${charge.attempts.length} attempt${charge.attempts.length > 1 ? "s" : ""}` : ""}.</div>
        </div>
      </div>
    )
  }
  return (
    <div className="verdict v-hard">
      <span className="vicon"><CrossIcon /></span>
      <div>
        <div className="vmain">Payment declined{replay}</div>
        <div className="vsub">{charge.finalResult?.customerMessage}{!charge.replayed ? " The chain stopped; later providers were not tried." : ""}</div>
      </div>
    </div>
  )
}

function CovRow({ label, universe, active, onToggle, single = false, hint }: { label: string; universe: readonly string[]; active: string[]; onToggle: (v: string) => void; single?: boolean; hint?: string }) {
  return (
    <div className="cov-row">
      <span className="cov-label">{label}{hint && <em className="cov-hint"> {hint}</em>}</span>
      <div className="cov-chips" role={single ? "radiogroup" : undefined}>
        {universe.map((v) => {
          const on = active.map((x) => x.toLowerCase()).includes(v.toLowerCase())
          return (
            <button
              key={v}
              className={`cov-chip ${single ? "radio" : ""} ${on ? "on" : ""}`}
              onClick={() => onToggle(v)}
              role={single ? "radio" : undefined}
              aria-checked={single ? on : undefined}
              aria-pressed={single ? undefined : on}
            >
              {v}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TickIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function CrossIcon() {
  return <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
}
function LockIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><rect x="4.5" y="10.5" width="15" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.8" /><path d="M8 10.5V7.5a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="12" cy="15" r="1.4" fill="currentColor" /></svg>
}
