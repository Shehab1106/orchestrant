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

const COLORS = {
  bg: "#f4f5f7",
  card: "#ffffff",
  border: "#e4e6eb",
  text: "#1c1e21",
  muted: "#6b7280",
  accent: "#4f46e5",
  success: "#0f9d58",
  fail: "#d93025",
  pending: "#1a73e8",
}

function statusColor(status: string): string {
  if (status === "success") return COLORS.success
  if (status === "requires_3ds") return COLORS.pending
  return COLORS.fail
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
    <main
      style={{
        minHeight: "100vh",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: "system-ui, -apple-system, sans-serif",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "3rem 1rem",
      }}
    >
      <div style={{ width: "100%", maxWidth: 440 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 2px" }}>orchestrant</h1>
        <p style={{ color: COLORS.muted, margin: "0 0 20px", fontSize: 14 }}>
          Demo checkout &middot; routes and cascades through mock providers
        </p>

        <div
          style={{
            background: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: 24,
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          {phase === "form" && (
            <>
              <Field label="Amount (USD)">
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ color: COLORS.muted, marginRight: 6 }}>$</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    style={inputStyle}
                  />
                </div>
              </Field>

              <Field label="Test card">
                <select value={token} onChange={(e) => setToken(e.target.value)} style={inputStyle}>
                  {TEST_CARDS.map((c) => (
                    <option key={c.token} value={c.token}>
                      {c.token} — {c.label}
                    </option>
                  ))}
                </select>
              </Field>

              <button onClick={onPay} disabled={busy} style={primaryButton(busy)}>
                {busy ? "Processing…" : "Pay"}
              </button>
            </>
          )}

          {phase === "threeds" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🔐</div>
              <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>3-D Secure</h2>
              <p style={{ color: COLORS.muted, fontSize: 14, margin: "0 0 18px" }}>
                Your bank is asking you to authenticate this payment (mock ACS).
              </p>
              <button onClick={onCompleteChallenge} disabled={busy} style={primaryButton(busy)}>
                {busy ? "Authenticating…" : "Complete authentication"}
              </button>
              <button onClick={reset} disabled={busy} style={ghostButton}>
                Cancel
              </button>
            </div>
          )}

          {phase === "done" && result && (
            <>
              <div
                style={{
                  display: "inline-block",
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#fff",
                  background: statusColor(result.status),
                  marginBottom: 12,
                }}
              >
                {result.status.toUpperCase()}
                {result.replayed ? " · REPLAYED" : ""}
              </div>

              <p style={{ margin: "0 0 16px", fontSize: 15 }}>
                {result.status === "success"
                  ? `Approved by ${result.providerId}.`
                  : result.customerMessage}
              </p>

              <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>Attempt trail</div>
              <div
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  fontSize: 13,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                {result.attempts.length === 0 && (
                  <Row left="(no attempts)" right="" color={COLORS.muted} last />
                )}
                {result.attempts.map((a, i) => (
                  <Row
                    key={`${a.providerId}-${i}`}
                    left={a.providerId}
                    right={a.status}
                    color={statusColor(a.status)}
                    last={i === result.attempts.length - 1}
                  />
                ))}
              </div>

              {result.pspReference && (
                <p style={{ color: COLORS.muted, fontSize: 12, marginTop: 12 }}>
                  psp_reference: {result.pspReference}
                </p>
              )}

              <button onClick={reset} style={{ ...primaryButton(false), marginTop: 18 }}>
                New payment
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <span style={{ display: "block", fontSize: 13, color: COLORS.muted, marginBottom: 6 }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function Row({
  left,
  right,
  color,
  last,
}: {
  left: string
  right: string
  color: string
  last: boolean
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: last ? "none" : `1px solid ${COLORS.border}`,
      }}
    >
      <span>{left}</span>
      <span style={{ color, fontWeight: 600 }}>{right}</span>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 15,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  outline: "none",
  background: "#fff",
  color: COLORS.text,
  boxSizing: "border-box",
}

function primaryButton(busy: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "11px 12px",
    fontSize: 15,
    fontWeight: 600,
    color: "#fff",
    background: busy ? "#a5a3e0" : COLORS.accent,
    border: "none",
    borderRadius: 8,
    cursor: busy ? "default" : "pointer",
  }
}

const ghostButton: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  fontSize: 14,
  color: COLORS.muted,
  background: "transparent",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  marginTop: 8,
}
