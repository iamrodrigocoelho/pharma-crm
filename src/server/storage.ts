import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

// Armazenamento de arquivos em disco, no lugar do Storage do Supabase.
//
// Três coisas que aquele serviço fazia e precisam continuar existindo:
//   · TETO de tamanho e lista de tipos por bucket — eram colunas de `storage.buckets`,
//     e eram a ÚLTIMA barreira (as actions validam antes, com mensagem em português).
//     Viraram a tabela `BUCKETS` aqui, aplicada no `upload`.
//   · URL ASSINADA com validade — virou um HMAC conferido pela rota /api/arquivos.
//   · bucket PÚBLICO (só `marca`) — a rota serve sem assinatura apenas esses.
//
// 🔴 O DIRETÓRIO PRECISA SER UM VOLUME PERSISTENTE. Em container sem volume montado
// os arquivos somem no próximo deploy, e o banco fica apontando para caminhos mortos.
// Ver docs/DEPLOY.md, seção 1.

export type Bucket = 'marca' | 'anexos' | 'canais-midia'

type ConfigBucket = { publico: boolean; tetoBytes: number; tipos: readonly string[] | null }

const BUCKETS: Record<Bucket, ConfigBucket> = {
  marca: { publico: true, tetoBytes: 1_048_576, tipos: ['image/png', 'image/jpeg', 'image/webp'] },
  anexos: {
    publico: false,
    tetoBytes: 10_485_760,
    tipos: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
  },
  'canais-midia': {
    publico: false,
    tetoBytes: 20_971_520,
    tipos: [
      'image/jpeg', 'image/png', 'image/webp',
      'audio/ogg', 'audio/mpeg', 'video/mp4', 'application/pdf',
    ],
  },
}

export function ehBucketPublico(bucket: string): boolean {
  return BUCKETS[bucket as Bucket]?.publico === true
}

// ⚠️ ESTE MÓDULO FAZ O BUILD AVISAR, E O AVISO TEM TRATAMENTO NO Dockerfile.
// O rastreador de arquivos do Turbopack não consegue provar o alcance de leituras e
// escritas cujo caminho só existe em tempo de execução — o que é a natureza de um
// armazenamento em disco. Ele então marca a RAIZ DO PROJETO como dependência da
// rota /api/arquivos, e a saída standalone passa a carregar `src/`, `tests/`,
// `docs/` e o CHANGELOG junto. Testado e descartado: trocar `process.cwd()` por
// caminho relativo, usar caminho absoluto, carregar o `fs` via `createRequire` e
// declarar `outputFileTracingExcludes` — o aviso vem das chamadas em si.
//
// Como a imagem é o que de fato importa, o Dockerfile PODA a saída antes de copiar.
// Ver a etapa de poda lá, que é onde a garantia mora.
export function raizDoArmazenamento(): string {
  return (process.env.PHARMA_STORAGE_DIR ?? process.env.AWAVE_STORAGE_DIR ?? '').trim() || `.dados${sep}storage`
}

type Erro = { message: string } | null

// Resolve `bucket` + `caminho` para um caminho absoluto, recusando qualquer coisa
// que escape do diretório do bucket. Sem esta checagem, um `caminho` com `..`
// vindo do banco (ou de um nome de arquivo) leria/escreveria fora da área.
export function caminhoAbsoluto(bucket: string, caminho: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(BUCKETS, bucket)) return null
  const base = resolve(raizDoArmazenamento(), bucket)
  const alvo = resolve(base, caminho)
  if (alvo !== base && !alvo.startsWith(base + sep)) return null
  return alvo
}

export type OpcoesUpload = { contentType?: string; upsert?: boolean }

class Area {
  constructor(private bucket: Bucket) {}

  private config(): ConfigBucket {
    return BUCKETS[this.bucket]
  }

  async upload(caminho: string, bytes: Buffer | Uint8Array, opts: OpcoesUpload = {}): Promise<{ error: Erro }> {
    const alvo = caminhoAbsoluto(this.bucket, caminho)
    if (!alvo) return { error: { message: `caminho inválido em ${this.bucket}: ${caminho}` } }

    const cfg = this.config()
    if (bytes.byteLength > cfg.tetoBytes) {
      return { error: { message: `arquivo acima do teto do bucket ${this.bucket} (${cfg.tetoBytes} bytes)` } }
    }
    if (cfg.tipos && opts.contentType && !cfg.tipos.includes(opts.contentType)) {
      return { error: { message: `tipo ${opts.contentType} não permitido em ${this.bucket}` } }
    }

    // `upsert: false` precisa FALHAR quando já existe — o chamador (anexos) conta com
    // isso para não sobrescrever objeto de outro registro num choque de UUID.
    if (opts.upsert !== true) {
      const existe = await stat(alvo).then(() => true, () => false)
      if (existe) return { error: { message: 'objeto já existe' } }
    }

    try {
      await mkdir(dirname(alvo), { recursive: true })
      await writeFile(alvo, bytes)
      // O tipo declarado é gravado ao lado: o disco não guarda metadado, e a rota
      // que serve o arquivo precisa dele para o Content-Type.
      if (opts.contentType) await writeFile(`${alvo}.tipo`, opts.contentType, 'utf8')
      return { error: null }
    } catch (e) {
      return { error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }

  async remove(caminhos: string[]): Promise<{ error: Erro }> {
    try {
      for (const c of caminhos) {
        const alvo = caminhoAbsoluto(this.bucket, c)
        if (!alvo) continue
        await rm(alvo, { force: true })
        await rm(`${alvo}.tipo`, { force: true })
      }
      return { error: null }
    } catch (e) {
      return { error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }

  async download(caminho: string): Promise<{ data: Buffer | null; error: Erro }> {
    const alvo = caminhoAbsoluto(this.bucket, caminho)
    if (!alvo) return { data: null, error: { message: 'caminho inválido' } }
    try {
      return { data: await readFile(alvo), error: null }
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }

  async tipoDeConteudo(caminho: string): Promise<string | null> {
    const alvo = caminhoAbsoluto(this.bucket, caminho)
    if (!alvo) return null
    return readFile(`${alvo}.tipo`, 'utf8').then((t) => t.trim() || null, () => null)
  }

  // Mesma forma do `.list()` do Supabase: nomes DENTRO de um prefixo, paginados.
  // Os varredores de órfãos (`midia-bucket`, `midia-tick`) dependem da paginação.
  // `metadata.size` é lido pela medição de cota do bucket de mídia; o Supabase
  // devolvia esse campo, e sem ele a cota mediria zero e nunca acusaria estouro.
  async list(
    prefixo: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ data: Array<{ name: string; metadata: { size: number } | null }> | null; error: Erro }> {
    const alvo = caminhoAbsoluto(this.bucket, prefixo)
    if (!alvo) return { data: null, error: { message: 'prefixo inválido' } }
    try {
      const nomes = await readdir(alvo, { withFileTypes: true })
      const visiveis = nomes
        // `.tipo` é metadado interno; devolvê-lo faria o varredor tratar metadado
        // como objeto órfão e apagar o content-type dos arquivos vivos.
        .filter((d) => !d.name.endsWith('.tipo'))
        .map((d) => ({ nome: d.name, arquivo: d.isFile() }))
        .sort((a, b) => a.nome.localeCompare(b.nome))
      const de = opts.offset ?? 0
      const ate = opts.limit === undefined ? undefined : de + opts.limit
      const fatia = visiveis.slice(de, ate)
      const itens = await Promise.all(
        fatia.map(async (d) => ({
          name: d.nome,
          metadata: d.arquivo
            ? { size: await stat(join(alvo, d.nome)).then((s) => s.size, () => 0) }
            : null,
        })),
      )
      return { data: itens, error: null }
    } catch (e) {
      const erro = e as { code?: string }
      // Prefixo inexistente é lista vazia, não falha — é o estado normal de um
      // workspace que ainda não subiu mídia nenhuma.
      if (erro?.code === 'ENOENT') return { data: [], error: null }
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }

  async createSignedUrl(
    caminho: string,
    segundos: number,
    opts: { download?: string } = {},
  ): Promise<{ data: { signedUrl: string } | null; error: Erro }> {
    if (!caminhoAbsoluto(this.bucket, caminho)) {
      return { data: null, error: { message: 'caminho inválido' } }
    }
    return { data: { signedUrl: assinarUrl(this.bucket, caminho, segundos, opts.download) }, error: null }
  }

  async createSignedUrls(
    caminhos: string[],
    segundos: number,
  ): Promise<{ data: Array<{ path: string; signedUrl: string | null; error: string | null }> | null; error: Erro }> {
    return {
      data: caminhos.map((c) =>
        caminhoAbsoluto(this.bucket, c)
          ? { path: c, signedUrl: assinarUrl(this.bucket, c, segundos), error: null }
          : { path: c, signedUrl: null, error: 'caminho inválido' },
      ),
      error: null,
    }
  }
}

export function armazenamento(): { from: (bucket: Bucket) => Area } {
  return { from: (bucket: Bucket) => new Area(bucket) }
}

// ---------------------------------------------------------------- assinatura

function segredo(): string {
  const s = (process.env.PHARMA_SESSION_SECRET ?? process.env.AWAVE_SESSION_SECRET ?? '').trim()
  if (s === '') throw new Error('AWAVE_SESSION_SECRET ausente — links de arquivo não podem ser assinados.')
  return s
}

function calcular(bucket: string, caminho: string, expira: number, download: string | undefined): string {
  return createHmac('sha256', segredo())
    .update(`${bucket}\n${caminho}\n${expira}\n${download ?? ''}`)
    .digest('base64url')
}

export function assinarUrl(bucket: string, caminho: string, segundos: number, download?: string): string {
  const expira = Date.now() + segundos * 1000
  const sig = calcular(bucket, caminho, expira, download)
  const q = new URLSearchParams({ exp: String(expira), sig })
  if (download) q.set('dl', download)
  const partes = caminho.split('/').map(encodeURIComponent).join('/')
  return `${baseDaUrl()}/api/arquivos/${bucket}/${partes}?${q.toString()}`
}

export function conferirAssinatura(
  bucket: string,
  caminho: string,
  expira: number,
  sig: string,
  download: string | undefined,
  agora = Date.now(),
): boolean {
  if (!Number.isFinite(expira) || expira <= agora) return false
  const esperado = Buffer.from(calcular(bucket, caminho, expira, download))
  const recebido = Buffer.from(sig)
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido)
}

// URL pública de bucket público (`marca`). Absoluta quando AWAVE_URL_PUBLICA existe,
// relativa caso contrário — o favicon e o logo entram em <img>, que aceita relativo.
export function baseDaUrl(): string {
  return (process.env.PHARMA_URL_PUBLICA ?? process.env.AWAVE_URL_PUBLICA ?? '').trim().replace(/\/+$/, '')
}

export function urlDeBucketPublico(bucket: string, caminho: string): string {
  const partes = caminho.split('/').map(encodeURIComponent).join('/')
  return `${baseDaUrl()}/api/arquivos/${bucket}/${partes}`
}

export { join as juntarCaminho }
