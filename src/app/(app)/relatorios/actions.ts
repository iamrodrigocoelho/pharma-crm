'use server'

import { db } from '@/server/db'
import { resolverWorkspaceAtivo } from '@/server/auth/workspace-ativo'
import { salvarRelatorio, excluirRelatorio } from '@/server/crm/relatorios'
import type { ConfigRelatorio } from '@/lib/relatorios'
import { usuarioAtual } from '@/server/auth/sessao'



type Res = { ok: true } | { erro: string }
type ResId = { ok: true; id: string } | { erro: string }

async function sessaoEws() {
  const cliente = db()
  const ws = await resolverWorkspaceAtivo({ cliente })
  return { cliente, ws }
}

export async function salvarNovoRelatorio(
  entrada: { nome: string; tipo: string; config: ConfigRelatorio },
): Promise<ResId> {
  const { cliente, ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  
  
  const user = await usuarioAtual()
  return salvarRelatorio(db(), ws, { ...entrada, criadoPor: user?.id ?? null })
}

export async function salvarEdicaoRelatorio(
  entrada: { id: string; nome: string; tipo: string; config: ConfigRelatorio },
): Promise<ResId> {
  const { ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  return salvarRelatorio(db(), ws, entrada)
}

export async function removerRelatorio(id: string): Promise<Res> {
  const { ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  return excluirRelatorio(db(), ws, id)
}
