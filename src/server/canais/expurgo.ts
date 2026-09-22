









import 'server-only'
import { criarOrcamento, type Orcamento } from '@/lib/orcamento-tick'
import { db } from '@/server/db'
import { lerConfig, gravarConfig } from '@/server/configuracoes'
import { detalheSeguro } from '@/lib/sanitizar-erro'
import { PROVIDER_DE_SIMULACAO } from '@/lib/canais/simulacao'
import { apagarOrfaosDoBucket } from '@/server/canais/midia-bucket'


export const JANELAS = { jobs: 30, custos: 400, simulador: 7 } as const


export const GRACA_DO_ORFAO_MS = 60 * 60 * 1000


export const INTERVALO_EXPURGO_MS = 24 * 60 * 60 * 1000


export const CHAVE_ULTIMO_EXPURGO = 'expurgo_ultimo_em'


export const TETO_POR_FRENTE_MS = 5_000


export const TETO_DE_CANAIS_DE_TESTE = 200

export type ResumoDoExpurgo = {
  
  rodou: boolean
  jobs: number
  custos: number
  conversasSimulador: number
  objetos: number
  sessoes: number
}

const VAZIO: ResumoDoExpurgo = { rodou: false, jobs: 0, custos: 0, conversasSimulador: 0, objetos: 0, sessoes: 0 }


export function deveExpurgar(
  ultimaISO: string | null,
  agoraMs: number,
  intervalo = INTERVALO_EXPURGO_MS,
): boolean {
  if (!ultimaISO) return true
  const t = Date.parse(ultimaISO)
  if (!Number.isFinite(t) || t > agoraMs) return true
  return agoraMs - t >= intervalo
}


function corte(agoraMs: number, dias: number): string {
  return new Date(agoraMs - dias * 24 * 60 * 60 * 1000).toISOString()
}


function quantas(data: unknown): number {
  return Array.isArray(data) ? data.length : 0
}


async function expurgarJobs(agoraMs: number): Promise<number> {
  const { data, error } = await db()
    .from('atendimento_jobs')
    .delete()
    .in('status', ['done', 'dead'])
    .lt('atualizado_em', corte(agoraMs, JANELAS.jobs))
    .select('id')
  if (error) throw error
  return quantas(data)
}


async function expurgarSessoesVencidas(): Promise<number> {
  const { data, error } = await db()
    .from('sessoes')
    .delete()
    .lt('expira_em', new Date().toISOString())
    .select('id')
  if (error) throw error
  return ((data as unknown[] | null) ?? []).length
}


async function expurgarCustos(agoraMs: number): Promise<number> {
  const { data, error } = await db()
    .from('custos_ia')
    .delete()
    .lt('criado_em', corte(agoraMs, JANELAS.custos))
    .select('id')
  if (error) throw error
  return quantas(data)
}

type CanalDeTeste = { id: string; workspace_id: string; config: { sessao?: string } | null }


async function expurgarSimulacao(agoraMs: number, orcamento: Orcamento): Promise<number> {
  const { data, error } = await db()
    .from('canais')
    .select('id, workspace_id, config')
    .eq('provider', PROVIDER_DE_SIMULACAO)
    
    
    
    
    
    
    
    .order('criado_em', { ascending: true })
    .limit(TETO_DE_CANAIS_DE_TESTE)
  if (error) throw error

  const limite = corte(agoraMs, JANELAS.simulador)
  let apagadas = 0
  for (const canal of (data ?? []) as CanalDeTeste[]) {
    if (!orcamento.cabe('expurgo')) return apagadas
    const sessao = canal.config?.sessao
    let consulta = db()
      .from('conversas')
      .delete()
      .eq('workspace_id', canal.workspace_id)
      .eq('canal_id', canal.id)
      .lt('criado_em', limite)
    
    if (typeof sessao === 'string' && sessao.length > 0) consulta = consulta.neq('chave_externa', sessao)
    const { data: mortas, error: erroDelete } = await consulta.select('id')
    if (erroDelete) throw erroDelete
    apagadas += quantas(mortas)
  }
  return apagadas
}


export async function expurgar(
  orcamento: Orcamento = criarOrcamento(Date.now()),
  agoraMs: number = Date.now(),
): Promise<ResumoDoExpurgo> {
  
  
  if (!orcamento.cabe('expurgo')) return VAZIO

  const resumo: ResumoDoExpurgo = { ...VAZIO }
  try {
    if (!deveExpurgar(await lerConfig(CHAVE_ULTIMO_EXPURGO), agoraMs)) return resumo
    await gravarConfig(CHAVE_ULTIMO_EXPURGO, new Date(agoraMs).toISOString())
  } catch (err) {
    console.warn('[canais/expurgo] relogio do braco indisponivel:', detalheSeguro(err))
    return resumo
  }
  resumo.rodou = true

  for (const [nome, frente] of [
    ['jobs', async () => (resumo.jobs = await expurgarJobs(agoraMs))],
    ['custos', async () => (resumo.custos = await expurgarCustos(agoraMs))],
    // Sessões vencidas nunca autenticam ninguém (a checagem de validade barra), mas
    // sem expurgo a tabela só cresce — uma linha por login, para sempre.
    ['sessoes', async () => (resumo.sessoes = await expurgarSessoesVencidas())],
    ['simulador', async () => (resumo.conversasSimulador = await expurgarSimulacao(agoraMs, orcamento))],
    
    
    ['objetos', async () => (resumo.objetos = await apagarOrfaosDoBucket(agoraMs, GRACA_DO_ORFAO_MS, orcamento))],
  ] as const) {
    if (!orcamento.cabe('expurgo')) break
    try {
      await frente()
    } catch (err) {
      console.warn(`[canais/expurgo] frente ${nome} falhou:`, detalheSeguro(err))
    }
  }

  return resumo
}
