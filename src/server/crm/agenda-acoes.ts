'use server'

import { db } from '@/server/db'
import { resolverWorkspaceAtivo } from '@/server/auth/workspace-ativo'
import { detalheSeguro } from '@/lib/sanitizar-erro'



type Res = { ok: true } | { erro: string }

async function sessaoEws() {
  const cliente = db()
  const ws = await resolverWorkspaceAtivo({ cliente })
  return { cliente, ws }
}

export async function concluirAtividade(id: string): Promise<Res> {
  const { ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  try {
    const { error } = await db().from('atividades')
      .update({ concluida_em: new Date().toISOString() }).eq('id', id).eq('workspace_id', ws)
    if (error) throw error
    return { ok: true }
  } catch (err) { console.error('[agenda] concluir', detalheSeguro(err)); return { erro: 'falha_concluir' } }
}

export async function reagendarAtividade(id: string, vencimentoISO: string): Promise<Res> {
  const { ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  try {
    const { error } = await db().from('atividades')
      .update({ vencimento: vencimentoISO }).eq('id', id).eq('workspace_id', ws)
    if (error) throw error
    return { ok: true }
  } catch (err) { console.error('[agenda] reagendar', detalheSeguro(err)); return { erro: 'falha_reagendar' } }
}
