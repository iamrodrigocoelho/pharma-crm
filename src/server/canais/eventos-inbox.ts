import 'server-only'
import postgres from 'postgres'
import { urlDoBanco } from '@/server/db/conexao'

// Ponte entre o `NOTIFY` do Postgres e as abas abertas no inbox.
//
// UMA conexão por processo fica em `LISTEN pharma_inbox` e distribui para os inscritos.
// Conexão dedicada porque `LISTEN` ocupa a sessão: usar o pool do app prenderia uma
// conexão de trabalho e, pior, a entrega dependeria de qual conexão o pool devolvesse.

// 🔴 TEM DE BATER COM O `pg_notify` DA MIGRATION 0063. Divergir aqui não quebra
// nada de forma visível — só faz o inbox parar de atualizar sozinho, em silêncio.
const CANAL = 'pharma_inbox'

type Ouvinte = (workspaceId: string) => void

const ouvintes = new Set<{ ws: string; fn: Ouvinte }>()
let conexao: postgres.Sql | null = null
let ligando: Promise<void> | null = null

async function garantirEscuta(): Promise<void> {
  if (conexao) return
  if (ligando) return ligando
  ligando = (async () => {
    // `max: 1` é a conexão do LISTEN e nada mais.
    const sql = postgres(urlDoBanco(), { max: 1, idle_timeout: 0, onnotice: () => {} })
    await sql.listen(CANAL, (payload) => {
      for (const o of ouvintes) if (o.ws === payload) o.fn(payload)
    })
    conexao = sql
    ligando = null
  })().catch((e) => {
    ligando = null
    throw e
  })
  return ligando
}

export async function inscreverNoInbox(workspaceId: string, fn: Ouvinte): Promise<() => void> {
  await garantirEscuta()
  const registro = { ws: workspaceId, fn }
  ouvintes.add(registro)
  return () => {
    ouvintes.delete(registro)
  }
}
