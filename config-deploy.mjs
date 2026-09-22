// Validação das variáveis de ambiente do deploy. Node puro, sem imports do app:
// é consumido pelo preflight (boot do container), pela tela /diagnostico e pelo
// cadastro. Antes descrevia três variáveis do Supabase; agora descreve as duas
// que sobraram quando o app passou a falar com um Postgres qualquer.
import { createHmac } from 'node:crypto'

const PLACEHOLDERS = [/\[YOUR-PASSWORD\]/i, /\[YOUR_PASSWORD\]/i, /<PASSWORD>/i, /\[SUA-SENHA\]/i]

const ONDE_ACHAR_DB =
  'É a connection string do seu Postgres, no formato ' +
  'postgres://usuario:senha@host:5432/banco. No EasyPanel ela aparece na aba do ' +
  'serviço de banco de dados; em outro host, no painel do provedor.'

const ONDE_ACHAR_SEGREDO =
  'Gere um valor aleatório longo e guarde: ele assina os cookies de sessão. ' +
  'No terminal: openssl rand -base64 48'

// Comprimento mínimo do segredo de sessão. Abaixo disso a assinatura do cookie
// vira força-bruta viável, e o custo de exigir mais é zero (é uma variável colada
// uma vez no deploy).
export const MINIMO_DO_SEGREDO = 32

export function ehUrlPostgres(url) {
  if (typeof url !== 'string' || url === '') return false
  try {
    const u = new URL(url)
    return u.protocol === 'postgres:' || u.protocol === 'postgresql:'
  } catch {
    return false
  }
}

// O pooler em modo TRANSACTION não sustenta advisory lock de sessão nem
// LISTEN/NOTIFY — os dois são usados aqui (runner de migrations e inbox ao vivo).
// A porta 6543 é a convenção do pgbouncer/supavisor para esse modo.
export function portaDeTransacao(url) {
  if (typeof url !== 'string') return false
  return /:6543([/?]|$)/.test(url)
}

export function validarConfig(env = {}) {
  const texto = (v) => (typeof v === 'string' ? v.trim() : '')
  const dbUrl = texto(env.DATABASE_URL)
  // O nome antigo (PHARMA_*) continua aceito para não derrubar um deploy que já
  // esteja no ar com ele colado. O nome novo tem precedência.
  const segredo = texto(env.PHARMA_SESSION_SECRET) || texto(env.AWAVE_SESSION_SECRET)

  const problemas = []
  const avisos = []
  const add = (lista, codigo, campo, titulo, comoResolver) =>
    lista.push({ codigo, campo, titulo, comoResolver })

  if (!dbUrl) {
    add(problemas, 'db_url_ausente', 'DATABASE_URL',
      'Falta a connection string do banco.', ONDE_ACHAR_DB)
  } else if (PLACEHOLDERS.some((re) => re.test(dbUrl))) {
    add(problemas, 'db_url_senha_placeholder', 'DATABASE_URL',
      'A connection string ainda está com o texto de exemplo no lugar da senha.',
      'Troque o marcador pela senha real do banco. ' + ONDE_ACHAR_DB)
  } else if (!ehUrlPostgres(dbUrl)) {
    add(problemas, 'db_url_invalida', 'DATABASE_URL',
      'Isso não parece uma connection string de Postgres.',
      'Ela começa com postgres:// ou postgresql://. ' + ONDE_ACHAR_DB)
  } else if (portaDeTransacao(dbUrl)) {
    add(avisos, 'db_url_transaction_pooler', 'DATABASE_URL',
      'A porta 6543 costuma ser o pooler em modo transaction.',
      'Esse modo não sustenta o lock das migrations nem o inbox ao vivo. ' +
      'Prefira a porta da conexão direta (normalmente 5432).')
  }

  if (!segredo) {
    add(problemas, 'segredo_ausente', 'PHARMA_SESSION_SECRET',
      'Falta o segredo que assina as sessões.', ONDE_ACHAR_SEGREDO)
  } else if (segredo.length < MINIMO_DO_SEGREDO) {
    add(problemas, 'segredo_curto', 'PHARMA_SESSION_SECRET',
      `O segredo tem ${segredo.length} caracteres; o mínimo é ${MINIMO_DO_SEGREDO}.`,
      ONDE_ACHAR_SEGREDO)
  }

  return {
    dbUrl,
    segredo,
    problemas,
    avisos,
    todasAusentes: !dbUrl && !segredo,
  }
}

// Código de uso único que protege o PRIMEIRO cadastro (o dono do deploy). Deriva
// do segredo de sessão, então quem controla o ambiente consegue lê-lo no preflight
// e ninguém de fora consegue adivinhá-lo.
export function tokenBootstrap(segredo) {
  if (typeof segredo !== 'string' || segredo === '') return null
  return createHmac('sha256', segredo).update('pharma-bootstrap').digest('hex').slice(0, 12).toUpperCase()
}
