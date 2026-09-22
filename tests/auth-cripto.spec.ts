import { describe, expect, it, beforeAll } from 'vitest'

// Cobre o que substituiu o GoTrue: hash de senha e token de sessão assinado.
// Não precisa de banco — é criptografia pura.

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres-aqui'

describe('hash de senha (scrypt)', () => {
  let gerar: typeof import('@/server/auth/senha').gerarHashDeSenha
  let conferir: typeof import('@/server/auth/senha').conferirSenha

  beforeAll(async () => {
    const m = await import('@/server/auth/senha')
    gerar = m.gerarHashDeSenha
    conferir = m.conferirSenha
  })

  it('aceita a senha certa e recusa a errada', async () => {
    const hash = await gerar('correia-cavalo-bateria-grampo')
    expect(await conferir('correia-cavalo-bateria-grampo', hash)).toBe(true)
    expect(await conferir('correia-cavalo-bateria-grampa', hash)).toBe(false)
  })

  it('o mesmo texto gera hashes DIFERENTES (sal por senha)', async () => {
    const a = await gerar('mesma-senha')
    const b = await gerar('mesma-senha')
    expect(a).not.toBe(b)
    expect(await conferir('mesma-senha', a)).toBe(true)
    expect(await conferir('mesma-senha', b)).toBe(true)
  })

  it('hash corrompido ou em formato estranho devolve false, não explode', async () => {
    expect(await conferir('x', '')).toBe(false)
    expect(await conferir('x', 'bcrypt$algo$outra$coisa$aqui$fim')).toBe(false)
    expect(await conferir('x', 'scrypt$16384$8$1$naoehbase64$tambemnao')).toBe(false)
  })

  it('normaliza unicode para a mesma senha digitada em teclados diferentes', async () => {
    // 'ã' composto (a + til) vs. pré-composto: o usuário digitou a mesma coisa.
    const hash = await gerar('senão')
    expect(await conferir('senão', hash)).toBe(true)
  })
})

describe('token de sessão', () => {
  let assinar: typeof import('@/server/auth/token-sessao').assinarToken
  let abrir: typeof import('@/server/auth/token-sessao').abrirToken

  beforeAll(async () => {
    const m = await import('@/server/auth/token-sessao')
    assinar = m.assinarToken
    abrir = m.abrirToken
  })

  it('vai e volta preservando o id da sessão', async () => {
    const expira = Date.now() + 60_000
    const t = await assinar('abc-123', expira, SEGREDO)
    expect(await abrir(t, SEGREDO)).toEqual({ sessaoId: 'abc-123', expiraEm: expira })
  })

  it('recusa token vencido', async () => {
    const t = await assinar('abc-123', Date.now() - 1, SEGREDO)
    expect(await abrir(t, SEGREDO)).toBeNull()
  })

  it('recusa token assinado com OUTRO segredo', async () => {
    const t = await assinar('abc-123', Date.now() + 60_000, 'outro-segredo-igualmente-longo-aqui-ok')
    expect(await abrir(t, SEGREDO)).toBeNull()
  })

  it('recusa token adulterado — inclusive esticando a validade', async () => {
    const expira = Date.now() + 60_000
    const t = await assinar('abc-123', expira, SEGREDO)
    const [id, , sig] = t.split('.')
    expect(await abrir(`${id}.${expira + 999_999}.${sig}`, SEGREDO)).toBeNull()
    expect(await abrir(`outro-id.${expira}.${sig}`, SEGREDO)).toBeNull()
  })

  it('recusa lixo sem explodir', async () => {
    expect(await abrir(undefined, SEGREDO)).toBeNull()
    expect(await abrir('', SEGREDO)).toBeNull()
    expect(await abrir('a.b', SEGREDO)).toBeNull()
    expect(await abrir('a.b.c.d', SEGREDO)).toBeNull()
    expect(await abrir('a.naoehnumero.c', SEGREDO)).toBeNull()
  })
})
