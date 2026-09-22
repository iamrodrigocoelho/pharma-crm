'use server'

import { createHmac } from 'node:crypto'
import { db } from '@/server/db'
import { resolverWorkspaceAtivo } from '@/server/auth/workspace-ativo'
import { getSecret, setSecret } from '@/server/secrets'
import { autenticarEntrada } from '@/server/api/autenticar'
import { gerarKeyId, gerarSegredo } from '@/server/api/credencial-id'
import { detalheSeguro } from '@/lib/sanitizar-erro'

async function sessaoEws() {
  const cliente = db()
  const ws = await resolverWorkspaceAtivo({ cliente })
  return { cliente, ws }
}


export async function gerarCredencial(rotulo: string): Promise<{ ok: true; keyId: string; segredo: string } | { erro: string }> {
  const r = rotulo.trim()
  if (!r) return { erro: 'rotulo_obrigatorio' }
  const { ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  const keyId = gerarKeyId()
  const segredo = gerarSegredo()
  try {
    
    
    
    
    
    
    if (!(await setSecret('api_key:' + keyId, segredo))) return { erro: 'falha_gerar' }  
    const { error } = await db().from('credenciais_api')
      .insert({ workspace_id: ws, key_id: keyId, rotulo: r })
    if (error) throw error
    return { ok: true, keyId, segredo }
  } catch (err) { console.error('[config] gerarCredencial', detalheSeguro(err)); return { erro: 'falha_gerar' } }
}


export async function revogarCredencial(keyId: string): Promise<{ ok: true } | { erro: string }> {
  const { ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  try {
    const { error } = await db().from('credenciais_api')
      .update({ revogado_em: new Date().toISOString() })
      .eq('key_id', keyId).eq('workspace_id', ws)
    if (error) throw error
    return { ok: true }
  } catch (err) { console.error('[config] revogarCredencial', detalheSeguro(err)); return { erro: 'falha_revogar' } }
}


export async function salvarWebhook(input: { endpoint_url: string; ativo: boolean }): Promise<{ ok: true } | { erro: string }> {
  const url = input.endpoint_url.trim()
  if (!/^https:\/\//i.test(url)) return { erro: 'url_invalida' }
  const { ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  try {
    const { error } = await db().from('webhook_config')
      .upsert({ workspace_id: ws, endpoint_url: url, ativo: input.ativo }, { onConflict: 'workspace_id' })
    if (error) throw error
    return { ok: true }
  } catch (err) { console.error('[config] salvarWebhook', detalheSeguro(err)); return { erro: 'falha_salvar' } }
}


export async function gerarSegredoWebhook(): Promise<{ ok: true; segredo: string } | { erro: string }> {
  const { ws } = await sessaoEws()
  if (!ws) return { erro: 'sem_workspace' }
  const segredo = gerarSegredo()
  try {
    
    
    
    
    if (!(await setSecret('webhook_secret:' + ws, segredo))) return { erro: 'falha_gerar' }
    return { ok: true, segredo }
  } catch (err) { console.error('[config] gerarSegredoWebhook', detalheSeguro(err)); return { erro: 'falha_gerar' } }
}


export async function testarConexao(keyId: string): Promise<{ ok: boolean }> {
  const { cliente, ws } = await sessaoEws()
  if (!ws) return { ok: false }
  const { data } = await cliente.from('credenciais_api')
    .select('key_id').eq('key_id', keyId).eq('workspace_id', ws).is('revogado_em', null).maybeSingle()
  if (!data) return { ok: false }
  const segredo = await getSecret('api_key:' + keyId)
  if (!segredo) return { ok: false }
  const raw = JSON.stringify({ ping: 1 })
  const sig = createHmac('sha256', segredo).update(raw).digest('hex')
  return { ok: autenticarEntrada({ raw, headers: { 'x-pharma-signature': sig }, valorSegredo: segredo }) }
}
