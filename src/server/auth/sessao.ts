import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/server/db'
import { conferirCredenciais, buscarUsuarioPorId, type Usuario } from '@/server/auth/usuarios'
import { COOKIE_SESSAO, abrirToken, assinarToken } from '@/server/auth/token-sessao'

export type { Usuario }

// Sessão do CRM. Substitui o GoTrue: o cookie carrega um id de sessão ASSINADO, e
// a linha correspondente vive em `public.sessoes`. As duas metades importam —
// a assinatura evita ida ao banco por cookie forjado (o middleware depende disso,
// porque roda no edge), e a linha permite encerrar sessão de verdade no logout.

const DURACAO_MS = 30 * 24 * 60 * 60 * 1000

type ResultadoEntrar = { ok: true } | { erro: string }
type ResultadoSair = { ok: true } | { erro: string }

async function cookieStore() {
  const { cookies } = await import('next/headers')
  return cookies()
}

function opcoesDoCookie(expiraEm: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Em HTTP puro (deploy local sem TLS) um cookie `secure` simplesmente não é
    // enviado, e o login ficaria num laço mudo de redirecionamento.
    secure:
      process.env.NODE_ENV === 'production' &&
      (process.env.PHARMA_SEM_TLS ?? process.env.AWAVE_SEM_TLS) !== '1',
    path: '/',
    expires: new Date(expiraEm),
  }
}

export async function abrirSessao(usuarioId: string): Promise<void> {
  const id = randomUUID()
  const expiraEm = Date.now() + DURACAO_MS
  const { error } = await db()
    .from('sessoes')
    .insert({ id, usuario_id: usuarioId, expira_em: new Date(expiraEm).toISOString() })
  if (error) throw error
  const store = await cookieStore()
  store.set(COOKIE_SESSAO, await assinarToken(id, expiraEm), opcoesDoCookie(expiraEm))
}

export async function entrar({ email, senha }: { email: string; senha: string }): Promise<ResultadoEntrar> {
  const r = await conferirCredenciais(email, senha)
  if ('erro' in r) return { erro: 'credenciais_invalidas' }
  await abrirSessao(r.usuario.id)
  return { ok: true }
}

export async function sair(): Promise<ResultadoSair> {
  const store = await cookieStore()
  const token = store.get(COOKIE_SESSAO)?.value
  const aberto = await abrirToken(token).catch(() => null)
  if (aberto) await db().from('sessoes').delete().eq('id', aberto.sessaoId)
  store.delete(COOKIE_SESSAO)
  return { ok: true }
}

// Usuário da requisição, ou null. Confere assinatura E a linha da sessão: só a
// primeira deixaria um logout sem efeito até o cookie vencer.
export async function usuarioAtual(): Promise<Usuario | null> {
  const store = await cookieStore()
  const aberto = await abrirToken(store.get(COOKIE_SESSAO)?.value).catch(() => null)
  if (!aberto) return null

  const { data, error } = await db()
    .from('sessoes')
    .select('usuario_id, expira_em')
    .eq('id', aberto.sessaoId)
    .maybeSingle()
  if (error || !data) return null

  const linha = data as { usuario_id: string; expira_em: string }
  if (new Date(linha.expira_em).getTime() <= Date.now()) return null
  return buscarUsuarioPorId(linha.usuario_id)
}

export async function exigirSessao(): Promise<Usuario> {
  const user = await usuarioAtual()
  if (!user) {
    const { redirect } = await import('next/navigation')
    redirect('/entrar')
    throw new Error('redirect não interrompeu o fluxo')
  }
  return user
}
