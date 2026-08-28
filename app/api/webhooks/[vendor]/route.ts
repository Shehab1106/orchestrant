import { json } from "../../../../src/api/http"

/**
 * Webhook ingestion stub. A real deployment verifies the vendor's signature and
 * routes the event into the settlement / dispute pipeline. For now it acks so
 * the vendor stops retrying and echoes the vendor it received.
 */
export async function POST(
  _req: Request,
  ctx: { params: { vendor: string } },
): Promise<Response> {
  const { vendor } = ctx.params
  return json(
    { received: true, vendor, note: "signature verification + dispatch not yet implemented" },
    200,
  )
}
