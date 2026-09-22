import 'server-only'
import type { Sql } from 'postgres'
import { esquema } from './esquema'
import type { Resposta, ErroDeBanco } from './construtor'

// Chamada de função do banco, na forma do `.rpc()` do Supabase.
//
// A forma do retorno segue a regra do PostgREST, e ela não é uniforme:
//   - função escalar (uuid, int, text) → devolve o VALOR
//   - `returns void`                   → devolve null
//   - `returns setof` / `returns table`→ devolve um ARRAY de linhas
// O app depende disso nos dois sentidos (`const { data: wsId } = await rpc('criar_workspace')`
// versus `reservar_jobs`, que itera `data`), então o tipo real vem do catálogo,
// não de uma convenção adivinhada no nome.

function comoErro(e: unknown): ErroDeBanco {
  const o = (e ?? {}) as Record<string, unknown>
  return {
    message: typeof o.message === 'string' ? o.message : String(e),
    code: typeof o.code === 'string' ? o.code : undefined,
    details: typeof o.detail === 'string' ? o.detail : undefined,
    hint: typeof o.hint === 'string' ? o.hint : undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class ChamadaRpc<T = any> implements PromiseLike<Resposta<T>> {
  private sql: Sql
  private nome: string
  private args: Record<string, unknown>
  private sinal: AbortSignal | null = null

  constructor(sql: Sql, nome: string, args: Record<string, unknown>) {
    this.sql = sql
    this.nome = nome
    this.args = args ?? {}
  }

  abortSignal(sinal: AbortSignal): this {
    this.sinal = sinal
    return this
  }

  then<R1 = Resposta<T>, R2 = never>(
    aoResolver?: ((v: Resposta<T>) => R1 | PromiseLike<R1>) | null,
    aoRejeitar?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.executar().then(aoResolver, aoRejeitar)
  }

  private async executar(): Promise<Resposta<T>> {
    try {
      const { funcoes } = await esquema()
      const meta = funcoes.get(this.nome)
      if (!meta) {
        return {
          data: null as T,
          error: { message: `função "${this.nome}" não existe no schema public`, code: '42883' },
          count: null,
        }
      }

      const valores: unknown[] = []
      const nomes = Object.entries(this.args)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => {
          valores.push(v ?? null)
          // O CAST NÃO É OPCIONAL. Um `$n` sem tipo chega como `unknown`, e o
          // Postgres recusa a chamada inteira porque não consegue escolher a
          // sobrecarga: "função reservar_jobs(p_limite => unknown, ...) não existe".
          const tipo = meta.tiposDosArgumentos.get(k)
          const cast = tipo ? `::${tipo}` : ''
          return `"${k.replace(/"/g, '""')}" => $${valores.length}${cast}`
        })
      const chamada = `"${this.nome.replace(/"/g, '""')}"(${nomes.join(', ')})`

      // `returns setof <tabela>` e `returns table (...)` expandem em colunas; o resto
      // é um valor só, e `select * from escalar()` devolveria uma coluna com o nome
      // da função — por isso os dois caminhos.
      const texto = meta.retornaConjunto
        ? `select * from ${chamada}`
        : `select ${chamada} as valor`

      const linhas = (await this.disparar(texto, valores)) as Array<Record<string, unknown>>

      if (meta.retornaVoid) return { data: null as T, error: null, count: null }
      if (meta.retornaConjunto) return { data: linhas as T, error: null, count: null }
      return { data: (linhas[0]?.valor ?? null) as T, error: null, count: null }
    } catch (e) {
      return { data: null as T, error: comoErro(e), count: null }
    }
  }

  private async disparar(texto: string, valores: unknown[]): Promise<unknown> {
    const consulta = this.sql.unsafe(texto, valores as never[])
    if (!this.sinal) return consulta
    if (this.sinal.aborted) throw { message: 'consulta abortada', code: 'PHARMA_ABORTADA' }
    const aoAbortar = () => {
      consulta.cancel()
    }
    this.sinal.addEventListener('abort', aoAbortar, { once: true })
    try {
      return await consulta
    } finally {
      this.sinal.removeEventListener('abort', aoAbortar)
    }
  }
}
