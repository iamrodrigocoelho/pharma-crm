'use server'

import { type ClienteDb, db } from '@/server/db'
import { COOKIE_WS_ATIVO } from '@/server/auth/workspace-ativo'
import { usuarioAtual, type Usuario } from '@/server/auth/sessao'



type Deps = {
  
  cliente?: ClienteDb
  
  setarCookie?: (id: string) => void
  
  revalidar?: () => void
  
  usuario?: Usuario | null
}


export type ResultadoTrocar = { ok: true } | { erro: 'nao_membro' | 'sem_sessao' }


export async function trocarWorkspaceCom(id: string, deps: Deps = {}): Promise<ResultadoTrocar> {
  const cliente = deps.cliente ?? (db())

  const user = deps.usuario !== undefined ? deps.usuario : await usuarioAtual()
  if (!user) return { erro: 'sem_sessao' }

  
  
  const { data, error } = await cliente
    .from('membros')
    .select('workspace_id')
    .eq('user_id', user.id)
    .eq('workspace_id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return { erro: 'nao_membro' } 

  const setar = deps.setarCookie ?? (await setarCookiePadrao())
  const revalidar = deps.revalidar ?? (await revalidarPadrao())
  setar(id)
  revalidar()
  return { ok: true }
}


export async function trocarWorkspace(id: string): Promise<ResultadoTrocar> {
  return trocarWorkspaceCom(id)
}

async function setarCookiePadrao(): Promise<(id: string) => void> {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  return (id: string) =>
    cookieStore.set(COOKIE_WS_ATIVO, id, { httpOnly: true, sameSite: 'lax', path: '/' })
}

async function revalidarPadrao(): Promise<() => void> {
  const { revalidatePath } = await import('next/cache')
  return () => revalidatePath('/', 'layout')
}
