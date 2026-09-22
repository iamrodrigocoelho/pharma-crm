import { describe, expect, it, beforeEach } from 'vitest'
import { Construtor } from '@/server/db/construtor'
import { definirEsquemaParaTeste, type ChaveEstrangeira } from '@/server/db/esquema'
import { parsearSelect } from '@/server/db/select'

// O `sql` nunca é usado nestes testes: só montamos o texto.
const sqlFalso = {} as never

const FKS: ChaveEstrangeira[] = [
  { nome: 'negocios_contato_fk', origem: 'negocios', destino: 'contatos', colunasOrigem: ['contato_id'], colunasDestino: ['id'] },
  { nome: 'negocios_empresa_fk', origem: 'negocios', destino: 'empresas', colunasOrigem: ['empresa_id'], colunasDestino: ['id'] },
  { nome: 'contatos_empresa_fk', origem: 'contatos', destino: 'empresas', colunasOrigem: ['empresa_id'], colunasDestino: ['id'] },
  { nome: 'conversas_canal_fk', origem: 'conversas', destino: 'canais', colunasOrigem: ['canal_id'], colunasDestino: ['id'] },
  { nome: 'conversas_contato_fk', origem: 'conversas', destino: 'contatos', colunasOrigem: ['contato_id'], colunasDestino: ['id'] },
  { nome: 'mensagens_conversa_fk', origem: 'mensagens', destino: 'conversas', colunasOrigem: ['conversa_id'], colunasDestino: ['id'] },
  { nome: 'campos_etapa_campo_fk', origem: 'campos_etapa', destino: 'campos_def', colunasOrigem: ['campo_id'], colunasDestino: ['id'] },
  { nome: 'campos_etapa_etapa_fk', origem: 'campos_etapa', destino: 'campos_def', colunasOrigem: ['etapa_id'], colunasDestino: ['id'] },
]

const COLUNAS = new Map<string, string>([
  ['contatos.campos', 'jsonb'],
  ['contatos.nome', 'text'],
  ['canais.config', 'jsonb'],
])

beforeEach(() => definirEsquemaParaTeste({ fks: FKS, colunas: COLUNAS }))

function novo(tabela: string) {
  return new Construtor(sqlFalso, tabela)
}

// Normaliza espaços para as asserções não dependerem de formatação.
async function montar(c: { montarParaTeste: () => Promise<{ texto: string; valores: unknown[] }> }) {
  const r = await c.montarParaTeste()
  return { texto: r.texto.replace(/\s+/g, ' ').trim(), valores: r.valores }
}

describe('parser do select', () => {
  it('separa colunas de embeds e guarda a dica de constraint', () => {
    const r = parsearSelect('id, nome, contatos(nome), canais!inner(provider), t:tipos!fk_x(slug)')
    expect(r.colunas.map((c) => c.apelido)).toEqual(['id', 'nome'])
    expect(r.embeds.map((e) => [e.tabela, e.interno, e.dica, e.apelido])).toEqual([
      ['contatos', false, null, 'contatos'],
      ['canais', true, null, 'canais'],
      ['tipos', false, 'fk_x', 't'],
    ])
  })

  it('aninha embeds dentro de embeds', () => {
    const r = parsearSelect('id, conversas!inner(canal_id, canais!inner(config))')
    expect(r.embeds[0].embeds[0].tabela).toBe('canais')
    expect(r.embeds[0].embeds[0].interno).toBe(true)
  })

  it('reconhece a forma de contagem', () => {
    expect(parsearSelect('id, contatos(count)').embeds[0].contagem).toBe(true)
  })
})

describe('leitura', () => {
  it('monta select simples com filtros posicionais na ordem do texto', async () => {
    const { texto, valores } = await montar(
      novo('contatos').select('id, nome').eq('workspace_id', 'w1').eq('id', 'c1'),
    )
    expect(texto).toBe(
      'select _p."id", _p."nome" from "contatos" _p where _p."workspace_id" = $1 and _p."id" = $2',
    )
    expect(valores).toEqual(['w1', 'c1'])
  })

  it('traz many-to-one como objeto jsonb', async () => {
    const { texto } = await montar(novo('negocios').select('id, contatos(nome)'))
    expect(texto).toContain('select to_jsonb(_s) from (select _t1."nome" from "contatos" _t1')
    expect(texto).toContain('_t1."id" = _p."contato_id"')
    expect(texto).toContain('as "contatos"')
  })

  it('traz one-to-many como array jsonb, com [] quando vazio', async () => {
    const { texto } = await montar(novo('empresas').select('id, contatos(nome)'))
    expect(texto).toContain('jsonb_agg')
    expect(texto).toContain("'[]'::jsonb")
    expect(texto).toContain('_t1."empresa_id" = _p."id"')
  })

  it('traz a forma de contagem como [{count}]', async () => {
    const { texto } = await montar(novo('empresas').select('id, contatos(count)'))
    expect(texto).toContain("jsonb_build_array(jsonb_build_object('count', count(*)))")
  })

  it('!inner filtra as linhas do pai com exists', async () => {
    const { texto, valores } = await montar(
      novo('conversas').select('id, canais!inner(provider)').neq('canais.provider', 'sim'),
    )
    expect(texto).toContain('exists (select 1 from "canais"')
    expect(texto).toContain('<> $1')
    expect(valores).toEqual(['sim', 'sim'])
  })

  it('aplica o filtro do embed também dentro do objeto devolvido', async () => {
    const { texto } = await montar(
      novo('conversas').select('id, canais!inner(provider)').neq('canais.provider', 'sim'),
    )
    // uma vez na subconsulta do embed, outra no exists que filtra o pai
    expect(texto.match(/<> \$/g)?.length).toBe(2)
  })

  it('encadeia exists para !inner aninhado', async () => {
    const { texto } = await montar(
      novo('mensagens').select('id, conversas!inner(canal_id, canais!inner(config))'),
    )
    const existsAninhado = texto.slice(texto.indexOf('where'))
    expect(existsAninhado).toContain('exists (select 1 from "conversas"')
    expect(existsAninhado).toContain('exists (select 1 from "canais"')
  })

  it('desambigua relação repetida pela dica de constraint', async () => {
    const { texto } = await montar(
      novo('campos_etapa').select('obrigatorio, campos_def!campos_etapa_campo_fk(slug)'),
    )
    expect(texto).toContain('_t1."id" = _p."campo_id"')
  })

  it('recusa relação ambígua sem dica', async () => {
    await expect(montar(novo('campos_etapa').select('obrigatorio, campos_def(slug)'))).rejects.toThrow(
      /ambígua/,
    )
  })

  it('traduz is/in/not/or para SQL', async () => {
    const { texto, valores } = await montar(
      novo('negocios')
        .select('id')
        .is('fechado_em', null)
        .in('status', ['aberto', 'ganho'])
        .not('previsao_fechamento', 'is', null)
        .or('fechado_em.is.null,fechado_em.gte.2024-01-01'),
    )
    expect(texto).toContain('_p."fechado_em" is null')
    expect(texto).toContain('_p."status" = any($1)')
    expect(texto).toContain('not (_p."previsao_fechamento" is null)')
    expect(texto).toContain('(_p."fechado_em" is null or _p."fechado_em" >= $2)')
    expect(valores).toEqual([['aberto', 'ganho'], '2024-01-01'])
  })

  it('filtra dentro de jsonb com ->>', async () => {
    const { texto } = await montar(novo('contatos').select('id').not('campos->>cnpj', 'is', null))
    expect(texto).toContain(`not (_p."campos"->>'cnpj' is null)`)
  })

  it('ordena com nulls last e pagina com range', async () => {
    const { texto } = await montar(
      novo('conversas').select('id').order('ultima_mensagem_em', { ascending: false, nullsFirst: false }).range(20, 39),
    )
    expect(texto).toContain('order by _p."ultima_mensagem_em" desc nulls last')
    expect(texto).toContain('limit 20 offset 20')
  })
})

describe('escrita', () => {
  it('insere e devolve as colunas pedidas via CTE', async () => {
    const { texto, valores } = await montar(
      novo('contatos').insert({ nome: 'Ana', workspace_id: 'w1' }).select('id, nome'),
    )
    expect(texto).toContain('with _dml as (insert into "contatos" ("nome", "workspace_id") values ($1, $2) returning *)')
    expect(texto).toContain('select _p."id", _p."nome" from _dml _p')
    expect(valores).toEqual(['Ana', 'w1'])
  })

  it('marca coluna jsonb com cast e manda o valor CRU (o driver serializa)', async () => {
    const { texto, valores } = await montar(
      novo('contatos').insert({ nome: 'Ana', campos: { cnpj: '1' } }),
    )
    expect(texto).toContain('$2::jsonb')
    // Cru, não `'{"cnpj":"1"}'`: pré-serializar aqui daria dupla codificação.
    expect(valores).toEqual(['Ana', { cnpj: '1' }])
  })

  it('usa DEFAULT para chave ausente em insert de várias linhas', async () => {
    const { texto } = await montar(
      novo('contatos').insert([{ nome: 'Ana', email: 'a@b.c' }, { nome: 'Rui' }]),
    )
    expect(texto).toContain('values ($1, $2), ($3, default)')
  })

  it('upsert vira on conflict do update sem sobrescrever a chave do conflito', async () => {
    const { texto } = await montar(
      novo('settings').upsert({ key: 'k', value: 'v' }, { onConflict: 'key' }),
    )
    expect(texto).toContain('on conflict ("key") do update set "value" = excluded."value"')
    expect(texto).not.toContain('"key" = excluded."key"')
  })

  it('update aplica o where e ignora chaves undefined', async () => {
    const { texto, valores } = await montar(
      novo('contatos').update({ nome: 'Ana', email: undefined }).eq('id', 'c1'),
    )
    expect(texto).toBe('update "contatos" _p set "nome" = $1 where _p."id" = $2 returning _p.*')
    expect(valores).toEqual(['Ana', 'c1'])
  })

  it('delete sem select ainda aplica o where', async () => {
    const { texto, valores } = await montar(novo('anexos').delete().eq('workspace_id', 'w1'))
    expect(texto).toBe('delete from "anexos" _p where _p."workspace_id" = $1 returning _p.*')
    expect(valores).toEqual(['w1'])
  })
})
