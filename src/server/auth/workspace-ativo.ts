import { type ClienteDb, db } from '@/server/db'
import { usuarioAtual, type Usuario } from '@/server/auth/sessao'



export const COOKIE_WS_ATIVO = 'ws_ativo'

type Deps = {
  
  cliente?: ClienteDb
  
  lerCookie?: () => string | undefined
  
  usuario?: Usuario | null
}


export async function resolverWorkspaceAtivo(deps: Deps = {}): Promise<string | null> {
  const cliente = deps.cliente ?? (db())
  const lerCookie = deps.lerCookie ?? (await lerCookiePadrao())

  const user = deps.usuario !== undefined ? deps.usuario : await usuarioAtual()
  if (!user) return null

  const { data, error } = await cliente
    .from('membros')
    .select('workspace_id, criado_em')
    .eq('user_id', user.id) 
    .order('criado_em', { ascending: true })
  if (error) throw error

  const memberships = (data as Array<{ workspace_id: string }> | null) ?? []
  if (memberships.length === 0) return null

  const doCookie = lerCookie()
  if (doCookie && memberships.some((m) => m.workspace_id === doCookie)) return doCookie

  
  return memberships[0].workspace_id
}


async function lerCookiePadrao(): Promise<() => string | undefined> {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  return () => cookieStore.get(COOKIE_WS_ATIVO)?.value
}
