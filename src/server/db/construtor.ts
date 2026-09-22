import 'server-only'
import type { Sql } from 'postgres'
import { conexao } from './conexao'
import { esquema, resolverRelacao, ehColunaJson, type ChaveEstrangeira } from './esquema'
import { parsearSelect, type Embed, type Coluna, type ListaSelecionada } from './select'

// Construtor de consultas com a MESMA forma do cliente do Supabase, sobre SQL.
// Encadeamento idêntico e retorno `{ data, error, count }` — nunca lança por erro
// do banco, porque os ~424 pontos de chamada do app testam `if (error)`. Uma versão
// que lançasse transformaria cada um deles num 500 não tratado.

export type ErroDeBanco = {
  message: string
  // Opcionais, e não `| null`: o app testa `erro?.code === '23505'` em vários pontos,
  // e um `null` aqui forçaria cast em cada um deles sem ganho nenhum.
  code?: string
  details?: string
  hint?: string
}

// `T = any` reproduz de propósito a ergonomia do cliente do Supabase sem tipos
// gerados: `data` é moldado por cast no ponto de uso (`data as Contato`), e são ~424
// pontos. Apertar isso agora daria centenas de erros sem revelar um bug sequer — o
// tipo certo mora no cast que cada consulta já faz.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Resposta<T = any> = { data: T; error: ErroDeBanco | null; count: number | null }

function comoErro(e: unknown): ErroDeBanco {
  const o = (e ?? {}) as Record<string, unknown>
  return {
    message: typeof o.message === 'string' ? o.message : String(e),
    // `code` é o SQLSTATE do Postgres, que o app já lê ('23505', '23503', '22P02'…).
    code: typeof o.code === 'string' ? o.code : undefined,
    details: typeof o.detail === 'string' ? o.detail : undefined,
    hint: typeof o.hint === 'string' ? o.hint : undefined,
  }
}

function erroLocal(message: string, code: string): ErroDeBanco {
  return { message, code }
}

// ---------------------------------------------------------------- identificadores

function id(nome: string): string {
  return `"${nome.replace(/"/g, '""')}"`
}

// Renderiza uma coluna, incluindo a forma `campos->>slug` do PostgREST, que o app usa
// para filtrar dentro de `jsonb`.
function renderColuna(expressao: string, prefixo: string): string {
  const m = expressao.match(/^([A-Za-z0-9_]+)\s*(->>|->)\s*(.+)$/)
  if (m) {
    const chave = m[3].trim().replace(/^['"]|['"]$/g, '')
    return `${prefixo}${id(m[1])}${m[2]}'${chave.replace(/'/g, "''")}'`
  }
  return `${prefixo}${id(expressao.trim())}`
}

// ---------------------------------------------------------------- parâmetros

class Parametros {
  valores: unknown[] = []
  add(valor: unknown, cast?: string): string {
    this.valores.push(valor)
    return `$${this.valores.length}${cast ? `::${cast}` : ''}`
  }
}

// ---------------------------------------------------------------- filtros

type Operador = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'in'

const SINAL: Record<Exclude<Operador, 'is' | 'in'>, string> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'like',
  ilike: 'ilike',
}

type Filtro =
  | { tipo: 'cmp'; alvo: string | null; coluna: string; op: Operador; valor: unknown; negado: boolean }
  | { tipo: 'or'; alvo: null; expressao: string }

function renderCmp(f: Extract<Filtro, { tipo: 'cmp' }>, prefixo: string, p: Parametros): string {
  const c = renderColuna(f.coluna, prefixo)
  let sql: string
  if (f.op === 'is') {
    if (f.valor === null) sql = `${c} is null`
    else if (f.valor === true) sql = `${c} is true`
    else if (f.valor === false) sql = `${c} is false`
    else sql = `${c} is not distinct from ${p.add(f.valor)}`
  } else if (f.op === 'in') {
    const lista = Array.isArray(f.valor) ? f.valor : [f.valor]
    // Lista vazia: `= any('{}')` é falso para toda linha — mesma semântica do PostgREST.
    sql = `${c} = any(${p.add(lista)})`
  } else {
    sql = `${c} ${SINAL[f.op]} ${p.add(f.valor)}`
  }
  return f.negado ? `not (${sql})` : sql
}

// `.or('fechado_em.is.null,fechado_em.gte.2024-01-01')` — sintaxe do PostgREST.
function renderOr(expressao: string, prefixo: string, p: Parametros): string {
  const partes: string[] = []
  let profundidade = 0
  let atual = ''
  for (const ch of expressao) {
    if (ch === '(') profundidade++
    else if (ch === ')') profundidade--
    if (ch === ',' && profundidade === 0) {
      partes.push(atual)
      atual = ''
      continue
    }
    atual += ch
  }
  if (atual.trim() !== '') partes.push(atual)

  const sqls = partes.map((parte) => {
    const bruto = parte.trim()
    const um = bruto.indexOf('.')
    const dois = bruto.indexOf('.', um + 1)
    if (um < 0 || dois < 0) throw new Error(`condição .or() inválida: "${bruto}"`)
    const coluna = bruto.slice(0, um)
    const op = bruto.slice(um + 1, dois) as Operador
    const cru = bruto.slice(dois + 1)
    const valor = cru === 'null' ? null : cru === 'true' ? true : cru === 'false' ? false : cru
    return renderCmp({ tipo: 'cmp', alvo: null, coluna, op, valor, negado: false }, prefixo, p)
  })
  return `(${sqls.join(' or ')})`
}

// ---------------------------------------------------------------- geração do select

type Contexto = {
  fks: ChaveEstrangeira[]
  p: Parametros
  // Filtros endereçados a um embed (`.eq('canais.provider', x)`), por apelido.
  porEmbed: Map<string, Filtro[]>
  seq: { n: number }
}

function proximoAlias(ctx: Contexto): string {
  ctx.seq.n += 1
  return `_t${ctx.seq.n}`
}

function condicaoDeJuncao(
  colunasPai: string[],
  colunasFilho: string[],
  aliasPai: string,
  aliasFilho: string,
): string {
  return colunasPai
    .map((cp, i) => `${aliasFilho}.${id(colunasFilho[i])} = ${aliasPai}.${id(cp)}`)
    .join(' and ')
}

function filtrosDoEmbed(embed: Embed, alias: string, ctx: Contexto): string[] {
  const lista = ctx.porEmbed.get(embed.apelido) ?? []
  return lista.map((f) =>
    f.tipo === 'or' ? renderOr(f.expressao, `${alias}.`, ctx.p) : renderCmp(f, `${alias}.`, ctx.p),
  )
}

// Expressão do select-list que materializa um embed como jsonb.
function gerarEmbed(embed: Embed, aliasPai: string, tabelaPai: string, ctx: Contexto): string {
  const rel = resolverRelacao(ctx.fks, tabelaPai, embed.tabela, embed.dica)
  const alias = proximoAlias(ctx)
  const juncao = condicaoDeJuncao(rel.colunasPai, rel.colunasFilho, aliasPai, alias)
  const extras = filtrosDoEmbed(embed, alias, ctx)
  const onde = [juncao, ...extras].join(' and ')

  if (embed.contagem) {
    return (
      `(select jsonb_build_array(jsonb_build_object('count', count(*))) ` +
      `from ${id(embed.tabela)} ${alias} where ${onde}) as ${id(embed.apelido)}`
    )
  }

  const interna = listaDeColunas(embed.colunas, embed.embeds, alias, embed.tabela, ctx, false)

  if (rel.tipo === 'um') {
    return (
      `(select to_jsonb(_s) from (select ${interna} from ${id(embed.tabela)} ${alias} ` +
      `where ${onde} limit 1) _s) as ${id(embed.apelido)}`
    )
  }
  return (
    `coalesce((select jsonb_agg(to_jsonb(_s)) from (select ${interna} ` +
    `from ${id(embed.tabela)} ${alias} where ${onde}) _s), '[]'::jsonb) as ${id(embed.apelido)}`
  )
}

// `!inner` não muda só o embed: ele FILTRA as linhas do pai. Recursivo, porque o
// `!inner` pode estar aninhado (`conversas!inner(canais!inner(config))`).
function gerarExistencia(embed: Embed, aliasPai: string, tabelaPai: string, ctx: Contexto): string | null {
  const rel = resolverRelacao(ctx.fks, tabelaPai, embed.tabela, embed.dica)
  const alias = proximoAlias(ctx)
  const juncao = condicaoDeJuncao(rel.colunasPai, rel.colunasFilho, aliasPai, alias)
  const extras = filtrosDoEmbed(embed, alias, ctx)
  const aninhados = embed.embeds
    .filter((e) => e.interno)
    .map((e) => gerarExistencia(e, alias, embed.tabela, ctx))
    .filter((s): s is string => s !== null)
  const onde = [juncao, ...extras, ...aninhados].join(' and ')
  return `exists (select 1 from ${id(embed.tabela)} ${alias} where ${onde})`
}

function listaDeColunas(
  colunas: Coluna[],
  embeds: Embed[],
  alias: string,
  tabela: string,
  ctx: Contexto,
  tudo: boolean,
): string {
  const itens: string[] = []
  if (tudo || (colunas.length === 0 && embeds.length === 0)) itens.push(`${alias}.*`)
  for (const c of colunas) {
    const expr = renderColuna(c.expressao, `${alias}.`)
    itens.push(c.apelido === c.expressao ? expr : `${expr} as ${id(c.apelido)}`)
  }
  for (const e of embeds) itens.push(gerarEmbed(e, alias, tabela, ctx))
  return itens.join(', ')
}

// ---------------------------------------------------------------- o construtor

type Operacao = 'select' | 'insert' | 'update' | 'upsert' | 'delete'
type Modo = 'muitos' | 'um' | 'talvezUm'

type Ordenacao = { coluna: string; ascendente: boolean; nulosPrimeiro: boolean | null }

const ALIAS_PAI = '_p'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Construtor<T = any> implements PromiseLike<Resposta<T>> {
  private sql: Sql
  private tabela: string
  private operacao: Operacao = 'select'
  private carga: Record<string, unknown>[] = []
  private patch: Record<string, unknown> = {}
  private onConflict: string | null = null
  private ignorarDuplicadas = false
  private selecao: ListaSelecionada | null = null
  private pediuSelect = false
  private filtros: Filtro[] = []
  private ordens: Ordenacao[] = []
  private limite: number | null = null
  private deslocamento = 0
  private modo: Modo = 'muitos'
  private contar: 'exact' | 'planned' | 'estimated' | null = null
  private somenteCabeca = false
  private sinal: AbortSignal | null = null

  constructor(sql: Sql, tabela: string) {
    this.sql = sql
    this.tabela = tabela
  }

  // ------------------------------------------------------------ operações

  select(colunas = '*', opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): this {
    this.selecao = parsearSelect(colunas)
    this.pediuSelect = true
    if (opts?.count) this.contar = opts.count
    if (opts?.head) this.somenteCabeca = true
    return this
  }

  insert(valores: Record<string, unknown> | Record<string, unknown>[]): this {
    this.operacao = 'insert'
    this.carga = Array.isArray(valores) ? valores : [valores]
    return this
  }

  upsert(
    valores: Record<string, unknown> | Record<string, unknown>[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.operacao = 'upsert'
    this.carga = Array.isArray(valores) ? valores : [valores]
    this.onConflict = opts?.onConflict ?? null
    this.ignorarDuplicadas = opts?.ignoreDuplicates ?? false
    return this
  }

  update(patch: Record<string, unknown>): this {
    this.operacao = 'update'
    this.patch = patch
    return this
  }

  delete(): this {
    this.operacao = 'delete'
    return this
  }

  // ------------------------------------------------------------ filtros

  private cmp(coluna: string, op: Operador, valor: unknown, negado = false): this {
    const ponto = coluna.indexOf('.')
    // `canais.provider` endereça o embed `canais`; `campos->>slug` não é endereçamento.
    const temAlvo = ponto > 0 && !coluna.includes('->')
    this.filtros.push({
      tipo: 'cmp',
      alvo: temAlvo ? coluna.slice(0, ponto) : null,
      coluna: temAlvo ? coluna.slice(ponto + 1) : coluna,
      op,
      valor,
      negado,
    })
    return this
  }

  eq(c: string, v: unknown): this { return this.cmp(c, 'eq', v) }
  neq(c: string, v: unknown): this { return this.cmp(c, 'neq', v) }
  gt(c: string, v: unknown): this { return this.cmp(c, 'gt', v) }
  gte(c: string, v: unknown): this { return this.cmp(c, 'gte', v) }
  lt(c: string, v: unknown): this { return this.cmp(c, 'lt', v) }
  lte(c: string, v: unknown): this { return this.cmp(c, 'lte', v) }
  like(c: string, v: string): this { return this.cmp(c, 'like', v) }
  ilike(c: string, v: string): this { return this.cmp(c, 'ilike', v) }
  is(c: string, v: null | boolean): this { return this.cmp(c, 'is', v) }
  in(c: string, v: readonly unknown[]): this { return this.cmp(c, 'in', [...v]) }

  not(c: string, op: Operador, v: unknown): this { return this.cmp(c, op, v, true) }

  // Forma genérica do PostgREST: operador escolhido em tempo de execução.
  filter(c: string, op: Operador, v: unknown): this { return this.cmp(c, op, v) }

  match(criterios: Record<string, unknown>): this {
    for (const [c, v] of Object.entries(criterios)) this.cmp(c, 'eq', v)
    return this
  }

  or(expressao: string): this {
    this.filtros.push({ tipo: 'or', alvo: null, expressao })
    return this
  }

  // ------------------------------------------------------------ modificadores

  order(coluna: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.ordens.push({
      coluna,
      ascendente: opts?.ascending ?? true,
      nulosPrimeiro: opts?.nullsFirst ?? null,
    })
    return this
  }

  limit(n: number): this {
    this.limite = n
    return this
  }

  range(de: number, ate: number): this {
    this.deslocamento = de
    this.limite = ate - de + 1
    return this
  }

  single(): this {
    this.modo = 'um'
    return this
  }

  maybeSingle(): this {
    this.modo = 'talvezUm'
    return this
  }

  abortSignal(sinal: AbortSignal): this {
    this.sinal = sinal
    return this
  }

  // ------------------------------------------------------------ execução

  then<R1 = Resposta<T>, R2 = never>(
    aoResolver?: ((v: Resposta<T>) => R1 | PromiseLike<R1>) | null,
    aoRejeitar?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.executar().then(aoResolver, aoRejeitar)
  }

  private async executar(): Promise<Resposta<T>> {
    try {
      return await this.rodar()
    } catch (e) {
      return { data: null as T, error: comoErro(e), count: null }
    }
  }

  // Monta o SQL sem executar. Usado pelos testes — e só por eles: a execução
  // continua passando por `rodar`, para não existirem dois caminhos de montagem.
  async montarParaTeste(): Promise<{ texto: string; valores: unknown[] }> {
    const { fks, colunas: tipos } = await esquema()
    const p = new Parametros()
    const ctx: Contexto = { fks, p, porEmbed: new Map(), seq: { n: 0 } }
    for (const f of this.filtros) {
      if (f.tipo === 'cmp' && f.alvo) {
        const atual = ctx.porEmbed.get(f.alvo) ?? []
        atual.push(f)
        ctx.porEmbed.set(f.alvo, atual)
      }
    }
    const sel = this.selecao ?? { tudo: true, colunas: [], embeds: [] }
    const texto =
      this.operacao === 'select'
        ? this.montarLeitura(sel, ctx, tipos)
        : this.montarEscrita(sel, ctx, tipos)
    return { texto, valores: p.valores }
  }

  private async rodar(): Promise<Resposta<T>> {
    const { fks, colunas: tipos } = await esquema()
    const p = new Parametros()
    const ctx: Contexto = { fks, p, porEmbed: new Map(), seq: { n: 0 } }

    for (const f of this.filtros) {
      if (f.tipo === 'cmp' && f.alvo) {
        const atual = ctx.porEmbed.get(f.alvo) ?? []
        atual.push(f)
        ctx.porEmbed.set(f.alvo, atual)
      }
    }

    const sel = this.selecao ?? { tudo: true, colunas: [], embeds: [] }

    // `head: true` só quer o total: a consulta de linhas seria um round-trip jogado fora.
    if (this.somenteCabeca && this.contar && this.operacao === 'select') {
      // O contexto de embeds precisa existir para o `!inner` entrar na contagem.
      for (const e of sel.embeds) void e
      return { data: null as T, error: null, count: await this.contarTotal(ctx, tipos) }
    }

    const texto =
      this.operacao === 'select'
        ? this.montarLeitura(sel, ctx, tipos)
        : this.montarEscrita(sel, ctx, tipos)

    const linhas = await this.disparar(texto, p.valores)

    let total: number | null = null
    if (this.contar && this.operacao === 'select') {
      total = await this.contarTotal(ctx, tipos)
    }

    if (this.somenteCabeca) return { data: null as T, error: null, count: total }

    return this.moldar(linhas, total)
  }

  private clausulaOnde(sel: ListaSelecionada, ctx: Contexto): string {
    const partes: string[] = []
    for (const f of this.filtros) {
      if (f.tipo === 'or') partes.push(renderOr(f.expressao, `${ALIAS_PAI}.`, ctx.p))
      else if (!f.alvo) partes.push(renderCmp(f, `${ALIAS_PAI}.`, ctx.p))
    }
    for (const e of sel.embeds) {
      if (!e.interno) continue
      const ex = gerarExistencia(e, ALIAS_PAI, this.tabela, ctx)
      if (ex) partes.push(ex)
    }
    return partes.length ? ` where ${partes.join(' and ')}` : ''
  }

  private clausulaOrdem(): string {
    if (this.ordens.length === 0) return ''
    const itens = this.ordens.map((o) => {
      const dir = o.ascendente ? 'asc' : 'desc'
      const nulos =
        o.nulosPrimeiro === null ? '' : o.nulosPrimeiro ? ' nulls first' : ' nulls last'
      return `${renderColuna(o.coluna, `${ALIAS_PAI}.`)} ${dir}${nulos}`
    })
    return ` order by ${itens.join(', ')}`
  }

  private clausulaFatia(): string {
    let s = ''
    if (this.limite !== null) s += ` limit ${Number(this.limite)}`
    if (this.deslocamento > 0) s += ` offset ${Number(this.deslocamento)}`
    return s
  }

  private montarLeitura(
    sel: ListaSelecionada,
    ctx: Contexto,
    _tipos: Map<string, string>,
  ): string {
    // O `where` é montado ANTES da lista de colunas porque os dois consomem
    // parâmetros posicionais, e a ordem de `$n` tem de bater com a de `p.valores`.
    // Portanto: gere o texto na ordem em que ele será concatenado.
    const lista = listaDeColunas(sel.colunas, sel.embeds, ALIAS_PAI, this.tabela, ctx, sel.tudo)
    const onde = this.clausulaOnde(sel, ctx)
    if (this.somenteCabeca) {
      return `select 1 from ${id(this.tabela)} ${ALIAS_PAI}${onde}${this.clausulaFatia()}`
    }
    return (
      `select ${lista} from ${id(this.tabela)} ${ALIAS_PAI}` +
      `${onde}${this.clausulaOrdem()}${this.clausulaFatia()}`
    )
  }

  // 🔴 O VALOR VAI CRU, E O CAST `::jsonb` É QUE FAZ O TRABALHO. Não serialize antes:
  // o driver já aplica JSON.stringify quando o destino é json/jsonb, e pré-serializar
  // produz DUPLA codificação — a coluna recebe a *string* `{"a":1}` em vez do objeto,
  // `jsonb_typeof` vira 'string' e o check `campos jsonb_typeof = 'object'` recusa a
  // linha. Medido nos dois sentidos contra Postgres 17.
  //
  // O cast também é o que faz um ARRAY JS virar array JSON em vez de array do Postgres
  // — sem ele, `['a','b']` numa coluna jsonb seria codificado como `{a,b}` e falharia.
  private valorParaBind(coluna: string, valor: unknown, tipos: Map<string, string>, p: Parametros): string {
    if (ehColunaJson(tipos, this.tabela, coluna)) {
      return p.add(valor ?? null, 'jsonb')
    }
    return p.add(valor ?? null)
  }

  private montarEscrita(sel: ListaSelecionada, ctx: Contexto, tipos: Map<string, string>): string {
    const p = ctx.p
    let comando: string

    if (this.operacao === 'delete') {
      comando = `delete from ${id(this.tabela)} ${ALIAS_PAI}${this.clausulaOnde(sel, ctx)} returning ${ALIAS_PAI}.*`
    } else if (this.operacao === 'update') {
      const sets = Object.entries(this.patch)
        .filter(([, v]) => v !== undefined)
        .map(([c, v]) => `${id(c)} = ${this.valorParaBind(c, v, tipos, p)}`)
      if (sets.length === 0) throw erroLocal('update sem colunas', 'PHARMA_UPDATE_VAZIO')
      comando =
        `update ${id(this.tabela)} ${ALIAS_PAI} set ${sets.join(', ')}` +
        `${this.clausulaOnde(sel, ctx)} returning ${ALIAS_PAI}.*`
    } else {
      // insert / upsert — união das chaves de todas as linhas, para que linhas
      // heterogêneas virem um único comando com DEFAULT onde a chave falta.
      const chaves = [...new Set(this.carga.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined)))]
      if (this.carga.length === 0 || chaves.length === 0) {
        throw erroLocal('insert sem colunas', 'PHARMA_INSERT_VAZIO')
      }
      const tuplas = this.carga.map((linha) => {
        const campos = chaves.map((c) =>
          Object.prototype.hasOwnProperty.call(linha, c) && linha[c] !== undefined
            ? this.valorParaBind(c, linha[c], tipos, p)
            : 'default',
        )
        return `(${campos.join(', ')})`
      })
      comando =
        `insert into ${id(this.tabela)} (${chaves.map(id).join(', ')}) values ${tuplas.join(', ')}`

      if (this.operacao === 'upsert') {
        const alvo = this.onConflict
          ? `(${this.onConflict.split(',').map((c) => id(c.trim())).join(', ')})`
          : ''
        if (this.ignorarDuplicadas || !this.onConflict) {
          comando += ` on conflict ${alvo} do nothing`
        } else {
          const sets = chaves
            .filter((c) => !this.onConflict!.split(',').map((x) => x.trim()).includes(c))
            .map((c) => `${id(c)} = excluded.${id(c)}`)
          comando +=
            sets.length > 0
              ? ` on conflict ${alvo} do update set ${sets.join(', ')}`
              : ` on conflict ${alvo} do nothing`
        }
      }
      comando += ' returning *'
    }

    if (!this.pediuSelect) {
      // Sem `.select()` o PostgREST não devolve linhas. Mantemos o comando (com
      // RETURNING, que é barato) e descartamos na moldagem — o que importa é que
      // `data` venha null, como o app espera.
      return comando
    }

    const lista = listaDeColunas(sel.colunas, sel.embeds, ALIAS_PAI, this.tabela, ctx, sel.tudo)
    return `with _dml as (${comando}) select ${lista} from _dml ${ALIAS_PAI}`
  }

  private async contarTotal(ctx: Contexto, _tipos: Map<string, string>): Promise<number | null> {
    // Contagem própria: o total IGNORA limit/offset, como o header Content-Range.
    const p = new Parametros()
    const ctx2: Contexto = { fks: ctx.fks, p, porEmbed: ctx.porEmbed, seq: { n: 1000 } }
    const sel = this.selecao ?? { tudo: true, colunas: [], embeds: [] }
    const partes: string[] = []
    for (const f of this.filtros) {
      if (f.tipo === 'or') partes.push(renderOr(f.expressao, `${ALIAS_PAI}.`, p))
      else if (!f.alvo) partes.push(renderCmp(f, `${ALIAS_PAI}.`, p))
    }
    for (const e of sel.embeds) {
      if (!e.interno) continue
      const ex = gerarExistencia(e, ALIAS_PAI, this.tabela, ctx2)
      if (ex) partes.push(ex)
    }
    const onde = partes.length ? ` where ${partes.join(' and ')}` : ''
    const texto = `select count(*)::int as n from ${id(this.tabela)} ${ALIAS_PAI}${onde}`
    const linhas = await this.disparar(texto, p.valores)
    const n = (linhas[0] as { n?: number } | undefined)?.n
    return typeof n === 'number' ? n : null
  }

  private async disparar(texto: string, valores: unknown[]): Promise<Record<string, unknown>[]> {
    const consulta = this.sql.unsafe(texto, valores as never[])
    if (!this.sinal) return (await consulta) as unknown as Record<string, unknown>[]
    if (this.sinal.aborted) throw erroLocal('consulta abortada', 'PHARMA_ABORTADA')
    // `.cancel()` avisa o servidor; sem ele a conexão ficaria presa à consulta
    // mesmo depois de o chamador desistir.
    const aoAbortar = () => {
      consulta.cancel()
    }
    this.sinal.addEventListener('abort', aoAbortar, { once: true })
    try {
      return (await consulta) as unknown as Record<string, unknown>[]
    } finally {
      this.sinal.removeEventListener('abort', aoAbortar)
    }
  }

  private moldar(linhas: Record<string, unknown>[], total: number | null): Resposta<T> {
    if (!this.pediuSelect && this.operacao !== 'select') {
      return { data: null as T, error: null, count: total }
    }
    if (this.modo === 'muitos') return { data: linhas as T, error: null, count: total }
    if (linhas.length > 1) {
      return {
        data: null as T,
        // Mesmo código do PostgREST para "a linha pedida não é única".
        error: erroLocal(`esperava no máximo 1 linha, vieram ${linhas.length}`, 'PGRST116'),
        count: total,
      }
    }
    if (linhas.length === 0) {
      if (this.modo === 'um') {
        return { data: null as T, error: erroLocal('nenhuma linha encontrada', 'PGRST116'), count: total }
      }
      return { data: null as T, error: null, count: total }
    }
    return { data: linhas[0] as T, error: null, count: total }
  }
}

export function construtorPara(tabela: string): Construtor {
  return new Construtor(conexao(), tabela)
}
