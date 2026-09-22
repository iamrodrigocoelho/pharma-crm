import 'server-only'
import { conexao } from './db/conexao'
import { Construtor, type Resposta, type ErroDeBanco } from './db/construtor'
import { ChamadaRpc } from './db/rpc'

export type { Resposta, ErroDeBanco }

// Cliente de banco do CRM. Mesmo formato de encadeamento do cliente do Supabase —
// `db().from('contatos').select(...).eq(...)` — porém falando SQL direto com o
// Postgres, sem PostgREST no meio.
//
// Antes existiam DOIS clientes: `admin()` (service_role, ignorava RLS) e o cliente
// de sessão (herdava o usuário do cookie, sujeito a RLS). Na prática o app já
// filtrava tudo por `workspace_id` explícito em toda consulta, e o caminho de
// escrita era quase todo `admin()`. Sem GoTrue não há `auth.uid()` para a RLS
// enxergar, então a fronteira de autorização passa a ser só a do app — que é onde
// ela de fato estava. Os dois clientes viram este.
export type ClienteDb = {
  from: (tabela: string) => Construtor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: <T = any>(nome: string, args?: Record<string, unknown>) => ChamadaRpc<T>
}

export function db(): ClienteDb {
  const sql = conexao()
  return {
    from: (tabela: string) => new Construtor(sql, tabela),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: <T = any>(nome: string, args: Record<string, unknown> = {}) =>
      new ChamadaRpc<T>(sql, nome, args),
  }
}

export { Construtor, ChamadaRpc }
