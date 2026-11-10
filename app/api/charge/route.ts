import { chargeSchema } from "../../../src/api/schemas"
import { json } from "../../../src/api/http"
import { buildDeps } from "../../../src/build-deps"
import { orchestrateCharge } from "../../../src/orchestration/orchestrate-charge"

export async function POST(req: Request): Promise<Response> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return json({ error: "invalid_json" }, 400)
  }

  const parsed = chargeSchema.safeParse(raw)
  if (!parsed.success) {
    return json({ error: "validation_failed", issues: parsed.error.issues }, 400)
  }

  const result = await orchestrateCharge(parsed.data, buildDeps())

  // A decline (failed) is 402 Payment Required; success and a 3DS pause are 200
  // — the caller branches on the `status` field.
  const httpStatus = result.finalStatus === "failed" ? 402 : 200

  return json(
    {
      status: result.finalStatus,
      replayed: result.replayed,
      providerId: result.finalResult.providerId,
      errorCategory: result.finalResult.errorCategory,
      customerMessage: result.finalResult.customerMessage,
      pspReference: result.finalResult.pspReference,
      threeDSChallenge: result.finalResult.threeDSChallenge,
      // The ordered provider chain the router resolved for this context.
      route: result.route,
      attempts: result.attempts.map((a) => ({
        providerId: a.providerId,
        status: a.result.status,
        errorCategory: a.result.errorCategory,
        errorCode: a.result.errorCode ?? null,
        pspReference: a.result.pspReference ?? null,
      })),
    },
    httpStatus,
  )
}
