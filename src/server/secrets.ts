import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { db } from '@/server/db'
import { mensagemSegura } from '@/lib/sanitizar-erro'

// Chaveiro do comprador (tokens de WhatsApp, chave da OpenAI, etc.).
//
// Antes: `vault.secrets` do Supabase, com a criptografia acontecendo DENTRO do
// Postgres. Agora: tabela `public.segredos` guardando apenas texto cifrado, e a
// criptografia acontecendo aqui, em AES-256-GCM.
//
// 🔴 A CHAVE NUNCA ENTRA NO BANCO. É essa a diferença que importa: um dump do
// Postgres não entrega os segredos, porque a chave está só no ambiente do processo.
// O outro lado da moeda: PERDER `AWAVE_SECRETS_KEY` é perder os segredos, e não há
// recuperação — só recadastrar. Está dito no DEPLOY.md.
//
// GCM e não CBC porque GCM autentica: um texto cifrado adulterado no banco falha na
// verificação da tag em vez de decifrar para lixo que o app usaria como token.

const JANELA_MS = 60_000
const TETO_DE_NOMES = 200
const BYTES_NONCE = 12

let relogio: () => number = Date.now
const ultimaLinha = new Map<string, { em: number; suprimidas: number }>()

export function reiniciarThrottleDoVault(agora: () => number = Date.now): void {
  relogio = agora
  ultimaLinha.clear()
}

function chave(): Buffer {
  const bruta = (
    process.env.PHARMA_SECRETS_KEY ??
    process.env.AWAVE_SECRETS_KEY ??
    process.env.PHARMA_SESSION_SECRET ??
    process.env.AWAVE_SESSION_SECRET ??
    ''
  ).trim()
  if (bruta === '') {
    throw new Error('AWAVE_SECRETS_KEY ausente — o chaveiro não pode ser aberto nem gravado.')
  }
  // Deriva 32 bytes de um segredo de texto livre: a variável é colada por uma
  // pessoa e não tem o tamanho exato que o AES-256 exige.
  return createHash('sha256').update(bruta).digest()
}

function cifrar(valor: string): string {
  const nonce = randomBytes(BYTES_NONCE)
  const c = createCipheriv('aes-256-gcm', chave(), nonce)
  const corpo = Buffer.concat([c.update(valor, 'utf8'), c.final()])
  return `v1.${nonce.toString('base64url')}.${corpo.toString('base64url')}.${c.getAuthTag().toString('base64url')}`
}

function decifrar(guardado: string): string | null {
  try {
    const [versao, nonce, corpo, tag] = guardado.split('.')
    if (versao !== 'v1') return null
    const d = createDecipheriv('aes-256-gcm', chave(), Buffer.from(nonce, 'base64url'))
    d.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([d.update(Buffer.from(corpo, 'base64url')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

function textoDoErro(erro: unknown, valor?: string): string {
  const bruto =
    erro && typeof erro === 'object' && 'message' in erro
      ? String((erro as { message: unknown }).message)
      : String(erro)
  const limpo = mensagemSegura(bruto)
  return valor && valor.length >= 8 ? limpo.split(valor).join('***') : limpo
}

function registrarFalha(
  operacao: 'get_secret' | 'set_secret' | 'delete_secret',
  nome: string,
  erro: unknown,
  valor?: string,
): void {
  const agora = relogio()
  const anterior = ultimaLinha.get(nome)
  if (anterior && agora - anterior.em < JANELA_MS) {
    anterior.suprimidas++
    return
  }
  if (ultimaLinha.size >= TETO_DE_NOMES) ultimaLinha.clear()
  ultimaLinha.set(nome, { em: agora, suprimidas: 0 })

  const engolidas = anterior?.suprimidas ?? 0
  const sufixo = engolidas > 0 ? ` (+${engolidas} suprimida(s) desde a ultima linha)` : ''
  console.error(`[vault] ${operacao} falhou: ${nome}${sufixo}`, textoDoErro(erro, valor))
}

export async function getSecret(nome: string): Promise<string | null> {
  const { data, error } = await db()
    .from('segredos')
    .select('valor_cifrado')
    .eq('nome', nome)
    .maybeSingle()
  if (error) {
    registrarFalha('get_secret', nome, error)
    return null
  }
  const linha = data as { valor_cifrado: string } | null
  if (!linha) return null
  const aberto = decifrar(linha.valor_cifrado)
  if (aberto === null) {
    // Chave trocada ou registro adulterado. Nomear é o que separa "segredo não
    // cadastrado" de "segredo ilegível" — os dois devolvem null para quem chama.
    registrarFalha('get_secret', nome, new Error('não foi possível decifrar (AWAVE_SECRETS_KEY mudou?)'))
  }
  return aberto
}

export async function setSecret(nome: string, valor: string): Promise<boolean> {
  try {
    const { error } = await db()
      .from('segredos')
      .upsert({ nome, valor_cifrado: cifrar(valor), atualizado_em: new Date().toISOString() },
              { onConflict: 'nome' })
    if (error) {
      registrarFalha('set_secret', nome, error, valor)
      return false
    }
    return true
  } catch (e) {
    registrarFalha('set_secret', nome, e, valor)
    return false
  }
}

export async function deleteSecret(nome: string): Promise<void> {
  const { error } = await db().from('segredos').delete().eq('nome', nome)
  if (error) registrarFalha('delete_secret', nome, error)
}
