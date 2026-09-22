export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ ok: true, api: 'pharma-crm', version: 'v1' })
}
