'use server'

import { db } from '@/server/db'
import { resolverWorkspaceAtivo } from '@/server/auth/workspace-ativo'
import { criarConvite } from '@/server/auth/convites'
import { usuarioAtual } from '@/server/auth/sessao'
import { buscarUsuariosPorIds } from '@/server/auth/usuarios'



export type MembroItem = {
  papel: 'owner' | 'membro'
  email: string | null
  desde: string
}

export type ConviteItem = {
  papel: 'owner' | 'membro'
  email: string | null
  expiraEm: string
  link: string
}

export type VistaEquipe = {
  souOwner: boolean
  membros: MembroItem[]
  convitesAbertos: ConviteItem[]
}

async function usuarioDaSessao(): Promise<string | null> {
  return (await usuarioAtual())?.id ?? null
}

export async function lerEquipe(): Promise<VistaEquipe | { erro: string }> {
  const userId = await usuarioDaSessao()
  if (!userId) return { erro: 'nao_autorizado' }

  const cliente = db()
  const ws = await resolverWorkspaceAtivo({ cliente })
  if (!ws) return { erro: 'sem_workspace' }

  const banco = db()
  const { data: membros } = await banco
    .from('membros')
    .select('user_id, papel, criado_em')
    .eq('workspace_id', ws)
    .order('criado_em', { ascending: true })

  const linhas = (membros ?? []) as Array<{
    user_id: string
    papel: 'owner' | 'membro'
    criado_em: string
  }>
  const souOwner = linhas.some((m) => m.user_id === userId && m.papel === 'owner')

  
  
  
  // Uma consulta para todos os membros. A forma antiga (`auth.admin.getUserById`
  // dentro do `map`) fazia uma chamada HTTP por linha da lista.
  const usuarios = await buscarUsuariosPorIds(linhas.map((m) => m.user_id))
  const comEmail: MembroItem[] = linhas.map((m) => ({
    papel: m.papel,
    email: usuarios.get(m.user_id)?.email ?? null,
    desde: m.criado_em,
  }))

  
  
  let convitesAbertos: ConviteItem[] = []
  if (souOwner) {
    const { data: convites } = await banco
      .from('convites')
      .select('papel, email, expira_em, token, aceito_em')
      .eq('workspace_id', ws)
      .is('aceito_em', null)
      .gt('expira_em', new Date().toISOString())
      .order('expira_em', { ascending: true })

    convitesAbertos = (
      (convites ?? []) as Array<{
        papel: 'owner' | 'membro'
        email: string | null
        expira_em: string
        token: string
      }>
    ).map((c) => ({
      papel: c.papel,
      email: c.email,
      expiraEm: c.expira_em,
      link: `/convite/${c.token}`,
    }))
  }

  return { souOwner, membros: comEmail, convitesAbertos }
}

export async function gerarConvite(
  papel: 'owner' | 'membro',
  email?: string,
): Promise<{ ok: true; vista: VistaEquipe } | { erro: string }> {
  if (papel !== 'owner' && papel !== 'membro') return { erro: 'papel_invalido' }

  const cliente = db()
  const ws = await resolverWorkspaceAtivo({ cliente })
  if (!ws) return { erro: 'sem_workspace' }

  
  
  const r = await criarConvite({
    workspaceId: ws,
    papel,
    email: email?.trim() || undefined,
  })
  if ('erro' in r) return r

  const vista = await lerEquipe()
  if ('erro' in vista) return vista
  return { ok: true, vista }
}


export async function cancelarConvite(
  token: string,
): Promise<{ ok: true; vista: VistaEquipe } | { erro: string }> {
  const cliente = db()
  const ws = await resolverWorkspaceAtivo({ cliente })
  if (!ws) return { erro: 'sem_workspace' }

  const userId = await usuarioDaSessao()
  if (!userId) return { erro: 'nao_autorizado' }

  const banco = db()
  const { data: eOwner } = await banco
    .from('membros')
    .select('id')
    .eq('workspace_id', ws)
    .eq('user_id', userId)
    .eq('papel', 'owner')
    .maybeSingle()
  if (!eOwner) return { erro: 'nao_autorizado' }

  
  
  const { error } = await banco
    .from('convites')
    .delete()
    .eq('workspace_id', ws)
    .eq('token', token)
    .is('aceito_em', null)
  if (error) return { erro: 'falha_ao_cancelar' }

  const vista = await lerEquipe()
  if ('erro' in vista) return vista
  return { ok: true, vista }
}
