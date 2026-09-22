import 'server-only'
import { db } from '@/server/db'
import { gerarHashDeSenha, conferirSenha } from '@/server/auth/senha'

// Usuários do CRM. Antes viviam em `auth.users`, tabela do GoTrue; agora vivem em
// `public.usuarios`, deste app. O campo `user_metadata` manteve o NOME que tinha no
// Supabase porque é ele que as telas leem (`nomeExibicao(user.user_metadata, ...)`)
// — trocar o nome aqui obrigaria a mexer em código de apresentação sem ganho algum.

export type Usuario = {
  id: string
  email: string
  user_metadata: Record<string, unknown>
}

const COLS = 'id, email, metadata'

function comoUsuario(linha: Record<string, unknown> | null): Usuario | null {
  if (!linha) return null
  return {
    id: String(linha.id),
    email: String(linha.email),
    user_metadata: (linha.metadata as Record<string, unknown> | null) ?? {},
  }
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase()
}

export type ResultadoCriar = { ok: true; usuario: Usuario } | { erro: 'email_em_uso' | 'falha' }

export async function criarUsuario({ email, senha }: { email: string; senha: string }): Promise<ResultadoCriar> {
  const hash = await gerarHashDeSenha(senha)
  const { data, error } = await db()
    .from('usuarios')
    .insert({ email: normalizarEmail(email), senha_hash: hash })
    .select(COLS)
    .single()
  // 23505 = unique_violation. É o caminho normal de "esse e-mail já se cadastrou",
  // não uma falha: conferir antes com um SELECT abriria uma corrida entre os dois.
  if (error?.code === '23505') return { erro: 'email_em_uso' }
  if (error || !data) return { erro: 'falha' }
  return { ok: true, usuario: comoUsuario(data as Record<string, unknown>)! }
}

export async function excluirUsuario(id: string): Promise<void> {
  await db().from('usuarios').delete().eq('id', id)
}

export async function buscarUsuarioPorId(id: string): Promise<Usuario | null> {
  const { data, error } = await db().from('usuarios').select(COLS).eq('id', id).maybeSingle()
  if (error) return null
  return comoUsuario(data as Record<string, unknown> | null)
}

// Versão em lote para as telas que listam membros: a forma antiga
// (`auth.admin.getUserById` dentro de um `map`) fazia uma ida por linha.
export async function buscarUsuariosPorIds(ids: readonly string[]): Promise<Map<string, Usuario>> {
  const unicos = [...new Set(ids)].filter((i) => typeof i === 'string' && i !== '')
  if (unicos.length === 0) return new Map()
  const { data, error } = await db().from('usuarios').select(COLS).in('id', unicos)
  if (error || !data) return new Map()
  const mapa = new Map<string, Usuario>()
  for (const linha of data as Record<string, unknown>[]) {
    const u = comoUsuario(linha)
    if (u) mapa.set(u.id, u)
  }
  return mapa
}

export async function atualizarMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
  await db().from('usuarios').update({ metadata }).eq('id', id)
}

export type Credencial = { ok: true; usuario: Usuario } | { erro: 'credenciais_invalidas' }

export async function conferirCredenciais(email: string, senha: string): Promise<Credencial> {
  const { data, error } = await db()
    .from('usuarios')
    .select('id, email, metadata, senha_hash')
    .eq('email', normalizarEmail(email))
    .maybeSingle()
  const linha = data as (Record<string, unknown> & { senha_hash?: string }) | null
  if (error || !linha) {
    // Gasta o mesmo tempo do caminho feliz mesmo sem usuário: sem isto, a diferença
    // de latência diria a quem tenta quais e-mails existem no sistema.
    await conferirSenha(senha, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA')
    return { erro: 'credenciais_invalidas' }
  }
  const confere = await conferirSenha(senha, String(linha.senha_hash ?? ''))
  if (!confere) return { erro: 'credenciais_invalidas' }
  return { ok: true, usuario: comoUsuario(linha)! }
}

export async function trocarSenha(id: string, senha: string): Promise<void> {
  await db().from('usuarios').update({ senha_hash: await gerarHashDeSenha(senha) }).eq('id', id)
}
