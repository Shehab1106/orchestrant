import { json } from "../../../src/api/http"

export async function GET(): Promise<Response> {
  return json({ status: "ok", service: "orchestrant" })
}
