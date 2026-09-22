import 'server-only'
import postgres from 'postgres'

// Conexão única com o Postgres. Substitui o cliente HTTP do Supabase (PostgREST):
// agora o app fala SQL direto, pelo mesmo pool, do processo do Next.
//
// `max` é conservador de propósito: o Next roda várias requisições em paralelo no
// mesmo processo, e cada conexão ociosa custa memória no Postgres do self-host.
// `prepare: false` mantém compatibilidade com poolers em modo transaction, que
// não carregam prepared statements entre checkouts.

let pool: postgres.Sql | null = null

export function urlDoBanco(): string {
  const url = (process.env.DATABASE_URL ?? '').trim()
  if (url === '') {
    throw new Error(
      'DATABASE_URL ausente. Aponte para o Postgres do deploy ' +
        '(postgres://usuario:senha@host:5432/banco). Ver docs/DEPLOY.md, seção 1.',
    )
  }
  return url
}

export function conexao(): postgres.Sql {
  if (pool) return pool
  pool = postgres(urlDoBanco(), {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false,
    // O app trafega `jsonb` como objeto JS em toda a camada CRM (coluna `campos`,
    // `config` de canal). O driver já devolve objeto; o que falta é a ida: sem isto
    // um objeto vira `[object Object]` no bind.
    transform: { undefined: null },
    onnotice: () => {},
  })
  return pool
}

// Usado pelos testes e pelo encerramento gracioso do container.
export async function encerrarConexao(): Promise<void> {
  if (!pool) return
  const atual = pool
  pool = null
  await atual.end({ timeout: 5 })
}
