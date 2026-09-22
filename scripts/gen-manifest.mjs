// gen-manifest.mjs — regera src/server/pharma-manifest.json.
//
// O manifesto é a lista canônica de "como os arquivos do PRODUTO saíram de fábrica":
// caminho → SHA-1 de blob do git. A tela de atualização compara essa lista com o disco
// para dizer ao comprador o que ele editou fora de `custom/` — e, portanto, o que a
// próxima atualização vai sobrescrever. Manifesto desatualizado faz essa tela acusar
// modificação em arquivo que ninguém tocou, e o aviso perde o sentido.
//
// Seleção: tudo que o git versiona ou versionaria (respeitando o .gitignore), MENOS:
//   · `custom/` — a zona do comprador; ela não é produto e nunca é sobrescrita.
//   · `tests/`  — não vai na imagem.
//   · os dois JSON que descrevem a si mesmos (o próprio manifesto e o carimbo).
//
// O SHA é o mesmo que `git hash-object` produz, e é calculado aqui direto do conteúdo
// do disco — sem passar pelo índice do git —, para que rodar isto com trabalho ainda
// não commitado produza o manifesto do que está de fato nos arquivos.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)))
const DESTINO = join(RAIZ, 'src/server/pharma-manifest.json')

const FORA = [
  (f) => f.startsWith('custom/'),
  (f) => f.startsWith('tests/'),
  (f) => f === 'src/server/pharma-manifest.json',
  (f) => f === 'src/server/pharma-stamp.json',
  (f) => f.endsWith('.DS_Store'),
]

export function shaDeBlob(conteudo) {
  // Formato do git: "blob <tamanho>\0<conteudo>", em SHA-1.
  return createHash('sha1')
    .update(`blob ${conteudo.length}\0`)
    .update(conteudo)
    .digest('hex')
}

function arquivosDoProduto() {
  // `--cached --others --exclude-standard` = versionados + novos ainda não adicionados,
  // já descontando o .gitignore. Assim o manifesto não depende de `git add` prévio.
  const saida = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: RAIZ, encoding: 'utf8' },
  )
  const unicos = [...new Set(saida.split('\n').map((l) => l.trim()).filter(Boolean))]
  return unicos
    .filter((f) => !FORA.some((teste) => teste(f)))
    // `--cached` ainda lista arquivo APAGADO no disco cuja remoção não foi indexada.
    // O manifesto descreve o disco, então ele sai da lista em vez de estourar a leitura.
    .filter((f) => existsSync(join(RAIZ, f)))
    .sort()
}

function main() {
  const anterior = JSON.parse(readFileSync(DESTINO, 'utf8'))
  const files = {}
  for (const caminho of arquivosDoProduto()) {
    files[caminho] = shaDeBlob(readFileSync(join(RAIZ, caminho)))
  }
  // `ref` e `algo` são do release e não se inventam aqui: quem publica a versão é quem
  // os define. Regerar o manifesto não promove ninguém a nova versão.
  const manifesto = { ref: anterior.ref, algo: anterior.algo, files }
  writeFileSync(DESTINO, JSON.stringify(manifesto, null, 2) + '\n')
  console.log(`[gen-manifest] ${Object.keys(files).length} arquivos em ${anterior.ref}`)
}

main()
