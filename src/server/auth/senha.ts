import 'server-only'
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// `promisify` do scrypt perde a sobrecarga que aceita opções (N, r, p) — e são
// justamente elas que definem o custo. Daí a ponte escrita à mão.
function scrypt(senha: string, sal: Buffer, tamanho: number, opcoes: ScryptOptions): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    scryptCb(senha, sal, tamanho, opcoes, (erro, derivada) =>
      erro ? rejeitar(erro) : resolver(derivada as Buffer),
    )
  })
}

// Hash de senha com scrypt da biblioteca padrão do Node — sem dependência nova.
// scrypt é memory-hard: o custo de uma tentativa não cai com GPU do jeito que cai
// para SHA. Os parâmetros são os recomendados como piso pelo OWASP para scrypt.
const N = 16384
const R = 8
const P = 1
const BYTES = 64
const BYTES_SAL = 16

export async function gerarHashDeSenha(senha: string): Promise<string> {
  const sal = randomBytes(BYTES_SAL)
  const derivada = await scrypt(senha.normalize('NFKC'), sal, BYTES, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${derivada.toString('base64')}`
}

export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  try {
    const partes = guardado.split('$')
    if (partes.length !== 6 || partes[0] !== 'scrypt') return false
    const [, n, r, p, salB64, hashB64] = partes
    const sal = Buffer.from(salB64, 'base64')
    const esperado = Buffer.from(hashB64, 'base64')
    const derivada = await scrypt(senha.normalize('NFKC'), sal, esperado.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    })
    // Comparação em tempo constante: `===` vazaria o prefixo correto pelo tempo.
    return derivada.length === esperado.length && timingSafeEqual(derivada, esperado)
  } catch {
    return false
  }
}
