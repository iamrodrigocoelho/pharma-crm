











import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

// A aposta deste teste MUDOU com a saída do Supabase, e ficou mais forte.
//
// Antes o navegador PRECISAVA de uma credencial (a chave anônima), e o teste vigiava
// para que a chave certa não fosse assada no bundle em vez de lida em tempo de
// execução. Agora NENHUM segredo vai para o navegador: o banco só é alcançado pelo
// servidor. Então o veneno pode ser procurado em TODO chunk, de servidor e de
// cliente — qualquer aparição é falha, e não há exceção legítima.
const VENENO_URL = 'postgres://veneno:veneno@veneno.invalid:5432/veneno'
const VENENO_SEGREDO = 'veneno-de-sessao-aaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const VENENO_CHAVE = 'veneno-de-chaveiro-aaaaaaaaaaaaaaaaaaaaaaaaaa'
const NEXT_BIN = createRequire(import.meta.url).resolve('next/dist/bin/next')

console.log('[anti-inlining] buildando com DATABASE_URL e segredos envenenados…')
execFileSync(process.execPath, [NEXT_BIN, 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: VENENO_URL,
    AWAVE_SESSION_SECRET: VENENO_SEGREDO,
    AWAVE_SECRETS_KEY: VENENO_CHAVE,
  },
})






const STANDALONE = '.next/standalone'
const RAIZ_CLIENTE = '.next/static'





















function raizesDoStandalone(dir) {
  if (!existsSync(dir)) return []
  const achadas =
    existsSync(join(dir, 'server.js')) && existsSync(join(dir, '.next', 'server')) ? [dir] : []
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.next') continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) achadas.push(...raizesDoStandalone(p))
  }
  return achadas
}
const raizes = raizesDoStandalone(STANDALONE)
if (raizes.length === 0) {
  
  
  console.error(
    `[anti-inlining] FALHOU: não achei nenhuma raiz de standalone sob ${STANDALONE}/ ` +
      '(procuro um diretório com `server.js` e `.next/server` juntos). ' +
      "Rode `pnpm build` e confira que o next.config.ts ainda tem `output: 'standalone'`.",
  )
  process.exit(1)
}
if (raizes.length > 1) {
  
  
  
  
  
  
  console.error(
    `[anti-inlining] FALHOU: achei ${raizes.length} raízes de standalone (${raizes.join(', ')}). ` +
      'Não dá pra saber qual delas vira a imagem. Rode `rm -rf .next` e builde de novo.',
  )
  process.exit(1)
}
const RAIZ_SERVIDOR = join(raizes[0], '.next', 'server', 'chunks')
console.log(`[anti-inlining] raiz do standalone: ${raizes[0]}`)
function arquivos(dir) {
  if (!existsSync(dir)) {
    
    console.error(`[anti-inlining] FALHOU: não achei ${dir} — o layout do build mudou?`)
    process.exit(1)
  }
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.js') ? [p] : []
  })
}
const ler = (f) => ({ f, txt: readFileSync(f, 'utf8') })
const servidor = arquivos(RAIZ_SERVIDOR).map(ler)
const conteudo = [...servidor, ...arquivos(RAIZ_CLIENTE).map(ler)]
console.log(`[anti-inlining] varrendo ${servidor.length} chunk(s) de server + ${conteudo.length - servidor.length} de cliente…`)
















const PISO_CHUNKS_SERVIDOR = 40
if (servidor.length < PISO_CHUNKS_SERVIDOR) {
  console.error(
    `[anti-inlining] FALHOU: só ${servidor.length} chunk(s) de server em ${RAIZ_SERVIDOR} ` +
      `(o piso é ${PISO_CHUNKS_SERVIDOR}). Varrer quase nada e passar é o mesmo que não varrer. ` +
      'Rode `rm -rf .next` e builde de novo; se o build está inteiro e o número caiu de verdade, ' +
      'é o Next que mudou o agrupamento de chunks — baixe o piso NO COMMIT que constatar isso.',
  )
  process.exit(1)
}


const VENENOS = [VENENO_URL, VENENO_SEGREDO, VENENO_CHAVE, 'veneno.invalid']
const assados = conteudo.filter((c) => VENENOS.some((v) => c.txt.includes(v)))


// Credencial de verdade assada no bundle, mesmo que não seja o veneno: uma
// connection string com senha embutida é o formato que vaza por descuido.
const URL_COM_SENHA = /postgres(?:ql)?:\/\/[^\s'"]*:[^\s'"@]+@/
const literais = conteudo.filter((c) => URL_COM_SENHA.test(c.txt))







const DINAMICOS = ['.DATABASE_URL', 'AWAVE_SESSION_SECRET', 'AWAVE_SECRETS_KEY']
const sumidos = DINAMICOS.filter((leitura) => !servidor.some((c) => c.txt.includes(leitura)))

const erros = []
if (assados.length) erros.push(`veneno assado em: ${assados.map((c) => c.f).join(', ')}`)
if (literais.length) erros.push(`credencial literal em: ${literais.map((c) => c.f).join(', ')}`)
if (sumidos.length) erros.push(`leitura dinâmica sumiu do bundle (constant-folded?): ${sumidos.join(', ')}`)

if (erros.length) {
  console.error('[anti-inlining] FALHOU:\n- ' + erros.join('\n- '))
  process.exit(1)
}
console.log('[anti-inlining] OK — nada assado, leitura dinâmica preservada.')
