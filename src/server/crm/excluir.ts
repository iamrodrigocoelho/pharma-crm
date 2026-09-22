'use server'

import { db, type ClienteDb } from '@/server/db'
import { resolverWorkspaceAtivo } from '@/server/auth/workspace-ativo'
import { detalheSeguro } from '@/lib/sanitizar-erro'
import { armazenamento } from '@/server/storage'



type Res = { ok: true } | { erro: string }

type Cli = ClienteDb

async function sessaoEws() {
  const cliente = db()
  const ws = await resolverWorkspaceAtivo({ cliente })
  return { cliente, ws }
}


async function apagar(tabela: string, ws: string, id: string): Promise<Res> {
  try {
    const { error } = await db().from(tabela).delete().eq('workspace_id', ws).eq('id', id)
    if (error) throw error
    await invalidarTudo()
    return { ok: true }
  } catch (err) {
    console.error(`[excluir] ${tabela}`, detalheSeguro(err))
    return { erro: 'falha_excluir' }
  }
}


async function invalidarTudo(): Promise<void> {
  try {
    const { revalidatePath } = await import('next/cache')
    revalidatePath('/', 'layout')
  } catch (err) {
    console.warn('[excluir] revalidatePath falhou (não-fatal):', detalheSeguro(err))
  }
}


export async function contarEfeitoContato(id: string): Promise<{ atividades: number }> {
  const { cliente, ws } = await sessaoEws()
  if (!ws) return { atividades: 0 }
  const { count } = await cliente
    .from('atividades').select('id', { count: 'exact', head: true })
    .eq('workspace_id', ws).eq('contato_id', id)
  return { atividades: count ?? 0 }
}


export async function contarEfeitoNegocio(
  id: string,
): Promise<{ atividades: number; historico: number }> {
  const { cliente, ws } = await sessaoEws()
  if (!ws) return { atividades: 0, historico: 0 }
  const { count: atividades } = await cliente
    .from('atividades').select('id', { count: 'exact', head: true })
    .eq('workspace_id', ws).eq('negocio_id', id)
  const { count: historico } = await cliente
    .from('historico_etapas').select('id', { count: 'exact', head: true })
    .eq('workspace_id', ws).eq('negocio_id', id)
  return { atividades: atividades ?? 0, historico: historico ?? 0 }
}

export async function excluirContato({ id }: { id: string }): Promise<Res> {
  const { ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  return apagar('contatos', ws, id)
}

export async function excluirEmpresa({ id }: { id: string }): Promise<Res> {
  const { ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  return apagar('empresas', ws, id)
}

export async function excluirNegocio({ id }: { id: string }): Promise<Res> {
  const { cliente, ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  
  
  
  await limparAnexosDoNegocio(cliente, ws, id)
  return apagar('negocios', ws, id)
}


async function limparAnexosDoNegocio(cliente: Cli, ws: string, negocioId: string): Promise<void> {
  try {
    const { data, error } = await cliente
      .from('anexos').select('caminho').eq('workspace_id', ws).eq('negocio_id', negocioId)
    if (error) throw error
    const caminhos = ((data ?? []) as { caminho: string }[]).map((a) => a.caminho)
    if (caminhos.length === 0) return

    await armazenamento().from('anexos').remove(caminhos)
  } catch (err) {
    console.warn('[excluir] anexos do negocio', negocioId, 'ficaram orfaos no bucket:', detalheSeguro(err))
  }
}

export async function excluirAtividade({ id }: { id: string }): Promise<Res> {
  const { ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  return apagar('atividades', ws, id)
}
