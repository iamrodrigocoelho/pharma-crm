import { armazenamento, conferirAssinatura, ehBucketPublico, type Bucket } from '@/server/storage'

// Serve os arquivos que antes vinham do Storage do Supabase.
//
// Duas portas, e só duas:
//   · bucket PÚBLICO (`marca`) — logo e favicon aparecem na tela de login, antes de
//     existir sessão. Sem assinatura, como era lá.
//   · bucket PRIVADO — exige a assinatura gerada por `createSignedUrl`, com validade.
//     Não basta estar logado: o link é escopado a UM caminho e vence.

export const dynamic = 'force-dynamic'

const BUCKETS_VALIDOS = new Set(['marca', 'anexos', 'canais-midia'])

export async function GET(
  req: Request,
  ctx: { params: Promise<{ bucket: string; caminho: string[] }> },
): Promise<Response> {
  const { bucket, caminho } = await ctx.params
  if (!BUCKETS_VALIDOS.has(bucket)) return new Response('não encontrado', { status: 404 })

  const chave = caminho.map(decodeURIComponent).join('/')
  const url = new URL(req.url)
  const download = url.searchParams.get('dl') ?? undefined

  if (!ehBucketPublico(bucket)) {
    const exp = Number(url.searchParams.get('exp'))
    const sig = url.searchParams.get('sig') ?? ''
    // Link vencido e link forjado devolvem a MESMA resposta: distinguir os dois
    // contaria a quem tenta que o caminho existe.
    if (!conferirAssinatura(bucket, chave, exp, sig, download)) {
      return new Response('link inválido ou vencido', { status: 403 })
    }
  }

  const area = armazenamento().from(bucket as Bucket)
  const { data, error } = await area.download(chave)
  if (error || !data) return new Response('não encontrado', { status: 404 })

  const tipo = (await area.tipoDeConteudo(chave)) ?? 'application/octet-stream'
  const headers = new Headers({
    'content-type': tipo,
    'content-length': String(data.byteLength),
    // Público pode ficar em cache compartilhado; assinado é por usuário e vence.
    'cache-control': ehBucketPublico(bucket)
      ? 'public, max-age=300'
      : 'private, no-store',
    // `nosniff` impede que o navegador reinterprete um upload como HTML e o execute
    // na nossa origem — o caminho clássico de XSS via arquivo enviado pelo usuário.
    'x-content-type-options': 'nosniff',
  })
  if (download) {
    headers.set('content-disposition', `attachment; filename="${download.replace(/"/g, '')}"`)
  }
  return new Response(new Uint8Array(data), { headers })
}
