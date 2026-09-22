'use server'

import { db } from '@/server/db'
import { resolverWorkspaceAtivo } from '@/server/auth/workspace-ativo'
import { criarAutomacao, atualizarAutomacao, alternarAtiva, excluirAutomacao } from '@/server/crm/automacoes'
import { CrmAutomacaoInvalida, CrmAutomacaoAlvoInvalido, CrmError } from '@/server/crm/erros'
import type { Regra } from '@/lib/automacao-forma'
import { detalheSeguro } from '@/lib/sanitizar-erro'



type Res = { ok: true } | { erro: string; slugs?: string[] }
type ResId = { ok: true; id: string } | { erro: string; slugs?: string[] }

async function wsAtivo(): Promise<string | null> {
  const cliente = db()
  return resolverWorkspaceAtivo({ cliente })
}


function traduzirErro(err: unknown, contexto: string): { erro: string; slugs?: string[] } {
  if (err instanceof CrmAutomacaoInvalida) return { erro: 'forma_invalida', slugs: err.slugs }
  if (err instanceof CrmAutomacaoAlvoInvalido) return { erro: 'alvo_invalido' }
  if (!(err instanceof CrmError)) console.error(`[automacoes] ${contexto}`, detalheSeguro(err))
  return { erro: 'falha_salvar' }
}


export async function salvarNovaAutomacao(regra: Regra): Promise<ResId> {
  try {
    const ws = await wsAtivo()
    if (!ws) return { erro: 'sem_workspace' }
    const automacao = await criarAutomacao(ws, { ...regra, nome: regra.nome.trim() })
    return { ok: true, id: automacao.id }
  } catch (err) {
    return traduzirErro(err, 'salvarNovaAutomacao')
  }
}


export async function salvarEdicaoAutomacao(id: string, regra: Regra): Promise<Res> {
  try {
    const ws = await wsAtivo()
    if (!ws) return { erro: 'sem_workspace' }
    const automacao = await atualizarAutomacao(ws, id, { ...regra, nome: regra.nome.trim() })
    if (!automacao) return { erro: 'nao_encontrada' }
    return { ok: true }
  } catch (err) {
    return traduzirErro(err, 'salvarEdicaoAutomacao')
  }
}

export async function alternarAutomacaoAtiva(id: string, ativo: boolean): Promise<Res> {
  try {
    const ws = await wsAtivo()
    if (!ws) return { erro: 'sem_workspace' }
    await alternarAtiva(ws, id, ativo)
    return { ok: true }
  } catch (err) {
    console.error('[automacoes] alternarAutomacaoAtiva', detalheSeguro(err))
    return { erro: 'falha_alternar' }
  }
}

export async function removerAutomacao(id: string): Promise<Res> {
  try {
    const ws = await wsAtivo()
    if (!ws) return { erro: 'sem_workspace' }
    await excluirAutomacao(ws, id)
    return { ok: true }
  } catch (err) {
    console.error('[automacoes] removerAutomacao', detalheSeguro(err))
    return { erro: 'falha_excluir' }
  }
}
