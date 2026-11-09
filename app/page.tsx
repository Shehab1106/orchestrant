"use client"

import { useState } from "react"

type Attempt = { providerId: string; status: string }

type ChargeResponse = {
  status: "success" | "failed" | "requires_3ds"
  replayed: boolean
  providerId: string
  errorCategory: string
  customerMessage: string
  pspReference: string | null
  threeDSChallenge: { kind: string; url: string } | null
  attempts: Attempt[]
}

const TEST_CARDS = [
  { token: "tok_ok", label: "Approves (via cascade)" },
  { token: "tok_3ds", label: "3-D Secure challenge, then approves" },
  { token: "invalid_card", label: "Hard decline (stops the chain)" },
]

function statusKind(status: string): "success" | "soft" | "hard" | "info" {
  if (status === "success") return "success"
  if (status === "soft_fail" || status === "timeout") return "soft"
  if (status === "requires_3ds") return "info"
  return "hard"
}

export default function Checkout() {
  const [amount, setAmount] = useState("50.00")
  const [token, setToken] = useState("tok_ok")
  const [busy, setBusy] = useState(false)
  const [idemKey, setIdemKey] = useState<string | null>(null)
  const [result, setResult] = useState<ChargeResponse | null>(null)
  const [phase, setPhase] = useState<"form" | "threeds" | "done">("form")

  async function postCharge(idem: string, threeDSProof: unknown): Promise<ChargeResponse> {
    const amountMinor = Math.round(Number.parseFloat(amount || "0") * 100)
    const res = await fetch("/api/charge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: idem,
        amount: amountMinor,
        currency: "USD",
        country: "US",
        card: { token, network: "visa" },
        threeDSProof,
      }),
    })
    return (await res.json()) as ChargeResponse
  }

  async function onPay() {
    setBusy(true)
    const idem = crypto.randomUUID()
    setIdemKey(idem)
    const r = await postCharge(idem, null)
    setResult(r)
    setPhase(r.status === "requires_3ds" ? "threeds" : "done")
    setBusy(false)
  }

  async function onCompleteChallenge() {
    if (!idemKey) return
    setBusy(true)
    const r = await postCharge(idemKey, {
      cavv: "mock-cavv",
      eci: "05",
      dsTransactionId: crypto.randomUUID(),
      version: "2.2.0",
    })
    setResult(r)
    setPhase("done")
    setBusy(false)
  }

  function reset() {
    setResult(null)
    setIdemKey(null)
    setPhase("form")
  }

  return (
    <main className="wrap">
      <div className="shell">
        <div className="brand">
          <h1>
            <span className="glyph" aria-hidden />
            orchestrant
          </h1>
          <span className="envtag">Test mode</span>
        </div>
        <p className="tagline">Routes and cascades a charge across mock providers.</p>

        <div className="card">
          {phase === "form" && (
            <>
              <label className="field">
                <span className="lbl">Amount (USD)</span>
                <div className="control">
                  <span className="prefix">$</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    aria-label="Amount in US dollars"
                  />
                </div>
              </label>

              <label className="field">
                <span className="lbl">Test card</span>
                <div className="control select-control">
                  <select value={token} onChange={(e) => setToken(e.target.value)}>
                    {TEST_CARDS.map((c) => (
                      <option key={c.token} value={c.token}>
                        {c.token} · {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <button className="btn btn-primary" onClick={onPay} disabled={busy}>
                {busy ? (
                  <>
                    <span className="spin" aria-hidden />
                    Processing
                  </>
                ) : (
                  "Pay"
                )}
              </button>
            </>
          )}

          {phase === "threeds" && (
            <div className="threeds">
              <div className="lock" aria-hidden>
                <LockIcon />
              </div>
              <h2>3-D Secure</h2>
              <p>Your bank is asking you to authenticate this payment (mock ACS).</p>
              <button className="btn btn-primary" onClick={onCompleteChallenge} disabled={busy}>
                {busy ? (
                  <>
                    <span className="spin" aria-hidden />
                    Authenticating
                  </>
                ) : (
                  "Complete authentication"
                )}
              </button>
              <button className="btn btn-ghost" onClick={reset} disabled={busy}>
                Cancel
              </button>
            </div>
          )}

          {phase === "done" && result && (
            <>
              <span className={`badge badge-${result.status === "requires_3ds" ? "3ds" : result.status}`}>
                {result.status === "success" && <TickIcon />}
                {result.status === "success"
                  ? "Payment approved"
                  : result.status === "failed"
                    ? "Payment declined"
                    : "Authentication required"}
                {result.replayed ? " · replayed" : ""}
              </span>

              <p className="result-msg">
                {result.status === "success" ? (
                  <>
                    Approved by <b className="mono">{result.providerId}</b>.
                  </>
                ) : (
                  result.customerMessage
                )}
              </p>

              <div className="trail-head">Attempt trail</div>
              <div className="trail">
                {result.attempts.length === 0 && (
                  <div className="attempt">
                    <span className="who" style={{ color: "var(--faint)" }}>
                      no attempts
                    </span>
                  </div>
                )}
                {result.attempts.map((a, i) => {
                  const kind = statusKind(a.status)
                  return (
                    <div
                      className="attempt"
                      key={`${a.providerId}-${i}`}
                      style={{ animationDelay: `${i * 110}ms` }}
                    >
                      <span className="node" aria-hidden>
                        <span className={`dot dot-${kind}`} />
                      </span>
                      <span className="who-row">
                        <span className="who">{a.providerId}</span>
                        <span className={`pill pill-${kind}`}>{a.status}</span>
                      </span>
                    </div>
                  )
                })}
              </div>

              {result.pspReference && (
                <p className="pspref">
                  <span>psp_reference</span>
                  <span className="v">{result.pspReference}</span>
                </p>
              )}

              <button className="btn btn-primary mt" onClick={reset}>
                New payment
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function TickIcon() {
  return (
    <svg className="tick" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8 10.5V7.5a4 4 0 018 0v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15" r="1.4" fill="currentColor" />
    </svg>
  )
}
