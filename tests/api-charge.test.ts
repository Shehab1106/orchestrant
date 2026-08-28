import { describe, it, expect } from "vitest"
import { POST } from "../app/api/charge/route"

function chargeReq(body: unknown): Request {
  return new Request("http://test/api/charge", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  })
}

describe("POST /api/charge", () => {
  it("routes, cascades, and returns success + the attempt trail", async () => {
    const res = await POST(
      chargeReq({
        idempotencyKey: "api_success_1",
        amount: 5000,
        currency: "USD",
        country: "US",
        card: { token: "tok_ok", network: "visa" },
      }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      providerId: string
      attempts: { providerId: string }[]
    }
    expect(body.status).toBe("success")
    expect(body.providerId).toBe("mock_b")
    expect(body.attempts.map((a) => a.providerId)).toEqual(["mock_a", "mock_b"])
  })

  it("returns 400 on a validation failure", async () => {
    const res = await POST(chargeReq({ amount: -1 }))
    expect(res.status).toBe(400)
  })
})
