// Parser da string de `select` do PostgREST.
//
// Gramática coberta (a que o app usa):
//   lista   := item (',' item)*
//   item    := coluna | embed
//   coluna  := nome | 'campos->>slug' | apelido:nome
//   embed   := [apelido ':'] tabela ['!' dica] '(' lista ')'
//   embed especial: tabela '(' 'count' ')'
// `*` isolado vale como "todas as colunas".

export type Coluna = { apelido: string; expressao: string }

export type Embed = {
  apelido: string
  tabela: string
  dica: string | null
  interno: boolean
  contagem: boolean
  colunas: Coluna[]
  embeds: Embed[]
}

export type ListaSelecionada = { tudo: boolean; colunas: Coluna[]; embeds: Embed[] }

// Divide por vírgulas que estão FORA de parênteses — `a, b(c, d), e` → ['a','b(c, d)','e'].
function separarNoTopo(texto: string): string[] {
  const partes: string[] = []
  let profundidade = 0
  let atual = ''
  for (const ch of texto) {
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
  return partes.map((p) => p.trim()).filter((p) => p !== '')
}

export function parsearSelect(texto: string): ListaSelecionada {
  const itens = separarNoTopo(texto)
  const colunas: Coluna[] = []
  const embeds: Embed[] = []
  let tudo = false

  for (const item of itens) {
    const abre = item.indexOf('(')
    if (abre === -1) {
      if (item === '*') {
        tudo = true
        continue
      }
      colunas.push(parsearColuna(item))
      continue
    }
    embeds.push(parsearEmbed(item, abre))
  }

  // Nenhuma coluna simples mas há embeds: o PostgREST NÃO traz as colunas do pai.
  // Só `*` traz. Manter isso evita vazar colunas que a chamada não pediu.
  return { tudo, colunas, embeds }
}

function parsearColuna(bruto: string): Coluna {
  const item = bruto.trim()
  // `apelido:coluna` — mas cuidado: `campos->>slug` não tem ':' , e um apelido
  // nunca contém '>' (o parser só separa no PRIMEIRO ':').
  const doisPontos = item.indexOf(':')
  if (doisPontos > 0) {
    const apelido = item.slice(0, doisPontos).trim()
    const alvo = item.slice(doisPontos + 1).trim()
    return { apelido, expressao: alvo }
  }
  return { apelido: item, expressao: item }
}

function parsearEmbed(item: string, abre: number): Embed {
  const cabeca = item.slice(0, abre).trim()
  const fecha = item.lastIndexOf(')')
  const corpo = item.slice(abre + 1, fecha)

  let apelido: string | null = null
  let resto = cabeca
  const doisPontos = resto.indexOf(':')
  if (doisPontos > 0) {
    apelido = resto.slice(0, doisPontos).trim()
    resto = resto.slice(doisPontos + 1).trim()
  }

  let interno = false
  let dica: string | null = null
  const bang = resto.indexOf('!')
  if (bang >= 0) {
    const marca = resto.slice(bang + 1).trim()
    resto = resto.slice(0, bang).trim()
    if (marca === 'inner') interno = true
    else if (marca === 'left') interno = false
    else dica = marca
  }

  const tabela = resto.trim()
  const interno2 = interno
  const dentro = corpo.trim()

  // `empresas(count)`: o PostgREST devolve `[{ count: N }]`.
  if (dentro === 'count') {
    return {
      apelido: apelido ?? tabela,
      tabela,
      dica,
      interno: interno2,
      contagem: true,
      colunas: [],
      embeds: [],
    }
  }

  const sub = parsearSelect(dentro)
  return {
    apelido: apelido ?? tabela,
    tabela,
    dica,
    interno: interno2,
    contagem: false,
    colunas: sub.colunas,
    embeds: sub.embeds,
  }
}
