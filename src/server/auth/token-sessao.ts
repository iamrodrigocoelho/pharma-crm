// Token de sessão assinado. SEM `server-only` de propósito: o middleware
// (`src/proxy.ts`) roda no runtime de edge, onde não há acesso ao Postgres — ele
// precisa decidir o redirecionamento só com criptografia, e por isso usa a Web
// Crypto API, que existe nos dois runtimes.
//
// Divisão de trabalho:
//   - middleware: confere ASSINATURA e VALIDADE (barato, sem banco)
//   - servidor:   confere se a sessão ainda existe na tabela (permite revogar)
// A assinatura sozinha nunca autoriza nada; ela só evita uma ida ao banco para
// cookie forjado ou vencido.

const CODIFICADOR = new TextEncoder()

export const COOKIE_SESSAO = 'pharma_sessao'

function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deBase64url(texto: string): ArrayBuffer {
  const pad = texto.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

async function chave(segredo: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    CODIFICADOR.encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export function segredoDeSessao(): string {
  const s = (process.env.PHARMA_SESSION_SECRET ?? process.env.AWAVE_SESSION_SECRET ?? '').trim()
  if (s === '') throw new Error('AWAVE_SESSION_SECRET ausente — as sessões não podem ser assinadas.')
  return s
}

export async function assinarToken(sessaoId: string, expiraEm: number, segredo = segredoDeSessao()): Promise<string> {
  const corpo = `${sessaoId}.${expiraEm}`
  const assinatura = await crypto.subtle.sign('HMAC', await chave(segredo), CODIFICADOR.encode(corpo))
  return `${corpo}.${base64url(new Uint8Array(assinatura))}`
}

export type TokenAberto = { sessaoId: string; expiraEm: number }

export async function abrirToken(
  token: string | undefined,
  segredo = segredoDeSessao(),
  agora = Date.now(),
): Promise<TokenAberto | null> {
  if (!token) return null
  const partes = token.split('.')
  if (partes.length !== 3) return null
  const [sessaoId, expiraTexto, assinatura] = partes
  const expiraEm = Number(expiraTexto)
  if (!Number.isFinite(expiraEm)) return null

  let ok = false
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      await chave(segredo),
      deBase64url(assinatura),
      CODIFICADOR.encode(`${sessaoId}.${expiraTexto}`),
    )
  } catch {
    return null
  }
  if (!ok) return null
  // Validade conferida DEPOIS da assinatura: um token vencido e um forjado devem
  // ser indistinguíveis para quem está tentando.
  if (expiraEm <= agora) return null
  return { sessaoId, expiraEm }
}
