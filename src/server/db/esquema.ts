import 'server-only'
import { conexao } from './conexao'

// Metadados do schema lidos do catálogo do Postgres, uma vez por processo.
//
// Por que introspecção e não um mapa escrito à mão: o `select` embutido do
// PostgREST (`negocios.select('id, contatos(nome)')`) resolve o JOIN pela chave
// estrangeira declarada no banco. Reproduzir isso exige a mesma fonte de verdade —
// um mapa manual sairia de sincronia na primeira migration que mexesse numa FK,
// e o erro apareceria como JOIN silenciosamente errado, não como falha de build.

export type ChaveEstrangeira = {
  nome: string
  origem: string
  destino: string
  colunasOrigem: string[]
  colunasDestino: string[]
}

export type Funcao = {
  nome: string
  retornaConjunto: boolean
  // 'c' = composto (tabela/record) — vira linha; qualquer outro = escalar.
  tipoDoRetorno: string
  retornaVoid: boolean
  // Tipo declarado de cada argumento de ENTRADA, por nome. Sem isto, um parâmetro
  // vai como `unknown` e o Postgres não consegue escolher a função:
  //   `função reservar_jobs(p_limite => unknown, p_reserva => unknown) não existe`
  // O PostgREST não tinha esse problema porque resolvia a assinatura antes de chamar.
  tiposDosArgumentos: Map<string, string>
}

// Tipo declarado de cada coluna, por "tabela.coluna". Serve para uma coisa só, mas
// decisiva: saber quando um valor JS precisa virar JSON explícito no bind. Sem isso
// um objeto gravado em coluna `jsonb` depende da inferência do driver, e um ARRAY
// JS em coluna `jsonb` seria codificado como array do Postgres — erro de tipo em
// tempo de execução, no caminho de escrita.
type Cache = {
  fks: ChaveEstrangeira[]
  funcoes: Map<string, Funcao>
  colunas: Map<string, string>
}

let cache: Cache | null = null
let carregando: Promise<Cache> | null = null

const SQL_FKS = `
  select
    con.conname as nome,
    src.relname as origem,
    tgt.relname as destino,
    (select array_agg(a.attname order by k.ord)
       from unnest(con.conkey) with ordinality k(num, ord)
       join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.num) as colunas_origem,
    (select array_agg(a.attname order by k.ord)
       from unnest(con.confkey) with ordinality k(num, ord)
       join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.num) as colunas_destino
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_class tgt on tgt.oid = con.confrelid
  join pg_namespace ns on ns.oid = src.relnamespace
  where con.contype = 'f' and ns.nspname = 'public'
`

const SQL_COLUNAS = `
  select c.relname as tabela, a.attname as coluna, t.typname as tipo
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
    and a.attnum > 0 and not a.attisdropped
`

// `proallargtypes`/`proargmodes` só vêm preenchidos quando há argumento de SAÍDA
// (`returns table (...)`). Quando são nulos, todos os argumentos são de entrada e
// `proargtypes` alinha com `proargnames`.
const SQL_FUNCOES = `
  select p.proname as nome,
         p.proretset as retorna_conjunto,
         t.typtype as tipo_retorno,
         (t.typname = 'void') as retorna_void,
         p.proargnames as arg_nomes,
         p.proargmodes::text[] as arg_modos,
         (select array_agg(format_type(u.oid, null) order by u.ord)
            from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]))
                 with ordinality u(oid, ord)) as arg_tipos
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_type t on t.oid = p.prorettype
  where n.nspname = 'public'
`

async function carregar(): Promise<Cache> {
  const sql = conexao()
  const [fks, funcoes, colunas] = await Promise.all([
    sql.unsafe(SQL_FKS),
    sql.unsafe(SQL_FUNCOES),
    sql.unsafe(SQL_COLUNAS),
  ])
  const mapa = new Map<string, Funcao>()
  for (const f of funcoes as unknown as Array<Record<string, unknown>>) {
    const nomes = (f.arg_nomes as string[] | null) ?? []
    const modos = (f.arg_modos as string[] | null) ?? null
    const tipos = (f.arg_tipos as string[] | null) ?? []
    const porNome = new Map<string, string>()
    for (let i = 0; i < nomes.length; i++) {
      // Sem `proargmodes` todos são de entrada; com ele, só 'i' (in), 'b' (inout)
      // e 'v' (variadic) recebem valor de quem chama.
      const modo = modos ? modos[i] : 'i'
      if (modo !== 'i' && modo !== 'b' && modo !== 'v') continue
      if (nomes[i] && tipos[i]) porNome.set(nomes[i], tipos[i])
    }
    mapa.set(String(f.nome), {
      nome: String(f.nome),
      retornaConjunto: Boolean(f.retorna_conjunto),
      tipoDoRetorno: String(f.tipo_retorno),
      retornaVoid: Boolean(f.retorna_void),
      tiposDosArgumentos: porNome,
    })
  }
  const tipos = new Map<string, string>()
  for (const c of colunas as unknown as Array<Record<string, unknown>>) {
    tipos.set(`${String(c.tabela)}.${String(c.coluna)}`, String(c.tipo))
  }
  return {
    colunas: tipos,
    fks: (fks as unknown as Array<Record<string, unknown>>).map((r) => ({
      nome: String(r.nome),
      origem: String(r.origem),
      destino: String(r.destino),
      colunasOrigem: (r.colunas_origem as string[]) ?? [],
      colunasDestino: (r.colunas_destino as string[]) ?? [],
    })),
    funcoes: mapa,
  }
}

export async function esquema(): Promise<Cache> {
  if (cache) return cache
  // Sem este guarda, N requisições simultâneas no boot disparariam N introspecções.
  if (!carregando) {
    carregando = carregar().then(
      (c) => {
        cache = c
        carregando = null
        return c
      },
      (e) => {
        carregando = null
        throw e
      },
    )
  }
  return carregando
}

export function esquecerEsquema(): void {
  cache = null
  carregando = null
}

// Injeta metadados sem tocar no banco. Existe para os testes de geração de SQL:
// sem isto eles exigiriam um Postgres de pé só para responder ao catálogo.
export function definirEsquemaParaTeste(c: {
  fks: ChaveEstrangeira[]
  funcoes?: Map<string, Funcao>
  colunas?: Map<string, string>
}): void {
  cache = { fks: c.fks, funcoes: c.funcoes ?? new Map(), colunas: c.colunas ?? new Map() }
  carregando = null
}

export type Relacao =
  | { tipo: 'um'; colunasPai: string[]; colunasFilho: string[] }
  | { tipo: 'muitos'; colunasPai: string[]; colunasFilho: string[] }

// Resolve como `pai` se liga a `filho`, do jeito que o PostgREST resolve:
//  - o PAI carrega a FK  → relação para UM objeto (many-to-one)
//  - o FILHO carrega a FK → relação para uma LISTA (one-to-many)
// `dica` é o `!nome_da_constraint` do select, que desempata quando existe mais de
// uma FK entre as duas tabelas (ex.: `campos_def!campos_etapa_campo_fk`).
export function resolverRelacao(
  fks: ChaveEstrangeira[],
  pai: string,
  filho: string,
  dica: string | null,
): Relacao {
  const porDica = (f: ChaveEstrangeira) => (dica ? f.nome === dica : true)

  const paiCarrega = fks.filter((f) => f.origem === pai && f.destino === filho && porDica(f))
  const filhoCarrega = fks.filter((f) => f.origem === filho && f.destino === pai && porDica(f))

  if (dica) {
    // Com dica explícita a constraint é única no banco — uma das duas listas tem 1.
    const f = paiCarrega[0] ?? filhoCarrega[0]
    if (!f) {
      throw new Error(
        `relação "${pai}" → "${filho}" não encontrada pela constraint "${dica}". ` +
          'Confira o nome da chave estrangeira nas migrations.',
      )
    }
    return f.origem === pai
      ? { tipo: 'um', colunasPai: f.colunasOrigem, colunasFilho: f.colunasDestino }
      : { tipo: 'muitos', colunasPai: f.colunasDestino, colunasFilho: f.colunasOrigem }
  }

  if (paiCarrega.length === 1) {
    const f = paiCarrega[0]
    return { tipo: 'um', colunasPai: f.colunasOrigem, colunasFilho: f.colunasDestino }
  }
  if (paiCarrega.length === 0 && filhoCarrega.length === 1) {
    const f = filhoCarrega[0]
    return { tipo: 'muitos', colunasPai: f.colunasDestino, colunasFilho: f.colunasOrigem }
  }

  // Ambíguo ou inexistente: falhar alto. O PostgREST também recusa (PGRST201) —
  // resolver "escolhendo a primeira" produziria um JOIN plausível e errado.
  const total = paiCarrega.length + filhoCarrega.length
  throw new Error(
    total === 0
      ? `não há chave estrangeira entre "${pai}" e "${filho}".`
      : `a relação entre "${pai}" e "${filho}" é ambígua (${total} chaves estrangeiras). ` +
        'Desambigue no select com `!nome_da_constraint`.',
  )
}

// `jsonb`/`json` precisam de JSON.stringify + cast explícito no bind; o resto vai cru.
export function ehColunaJson(colunas: Map<string, string>, tabela: string, coluna: string): boolean {
  const t = colunas.get(`${tabela}.${coluna}`)
  return t === 'jsonb' || t === 'json'
}
