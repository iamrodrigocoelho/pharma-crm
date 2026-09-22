// migrate.mjs — runner de migrations embutido no container (roda no boot, ANTES do server.js).
// Node puro, sem imports do app. Única dep: node_modules/postgres (copiada no Dockerfile).
//
// Regras:
//  - Sem DATABASE_URL         → no-op (exit 0): instalação antiga segue no fluxo manual.
//  - Banco VIRGEM             → aplica TODAS as migrations em ordem (setup zero-toque).
//  - Existente COM baseline   → aplica só as pendentes (registro em public.pharma_migrations).
//  - Existente SEM baseline   → exit 1 com instrução clara (última atualização manual, DEPLOY.md §7).
//  - Cada migration roda numa transação própria; o registro entra na MESMA transação.
//  - pg_advisory_lock serializa runners concorrentes (deploy com 2 containers vivos).
//  - tx.unsafe(conteúdo) sem params usa o simple protocol → aceita múltiplos statements
//    por arquivo. Migration futura que NÃO possa rodar em transação (ex.: CREATE INDEX
//    CONCURRENTLY) exigiria um marcador `-- pharma:no-transaction` — não implementado (YAGNI).
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const LOCK_KEY = 7455101

export function parseMigrationFile(name) {
  const m = name.match(/^(\d{4})_.+\.sql$/)
  return m ? { version: m[1], name } : null
}

// Faixa reservada às migrations do CLIENTE (custom/migrations): 9000–9999.
// Oficiais (db/migrations) ficam SEMPRE abaixo — namespaces disjuntos
// matam a colisão silenciosa de numeração entre release e customização.
export const CUSTOM_RANGE_START = '9000'
export function isCustomerVersion(version) {
  return version >= CUSTOM_RANGE_START // 4 dígitos: comparação lexicográfica == numérica
}

// PURA: decide o que aplicar. `files` = db/migrations (oficiais);
// `customFiles` = custom/migrations do comprador (OPCIONAL — ausente = zero mudança
// de comportamento pro parque instalado); `applied` = Set<string> de versões
// registradas; `dbIsFresh` = banco sem a tabela sentinela (sync_state, da 0001).
// (o cast JSDoc no default evita o TS inferir `never[]` pro parâmetro em quem chama)
export function planMigrations({ files, customFiles = /** @type {string[]} */ ([]), applied, dbIsFresh }) {
  const oficiais = files
    .map(parseMigrationFile)
    .filter(Boolean)
    .map((m) => ({ ...m, origem: 'oficial' }))
  const custom = customFiles
    .map(parseMigrationFile)
    .filter(Boolean)
    .map((m) => ({ ...m, origem: 'custom' }))
  // A validação de FAIXA roda ANTES do check de duplicata: com namespaces válidos
  // (oficial < 9000, custom >= 9000) uma duplicata ENTRE pastas é impossível — o
  // check de duplicata abaixo só precisa olhar o conjunto mesclado.
  const customFora = custom.find((m) => !isCustomerVersion(m.version))
  if (customFora) return { error: 'custom_fora_da_faixa', apply: [], arquivo: customFora.name }
  const oficialNaFaixa = oficiais.find((m) => isCustomerVersion(m.version))
  if (oficialNaFaixa) return { error: 'oficial_na_faixa_custom', apply: [], arquivo: oficialNaFaixa.name }
  const migrations = [...oficiais, ...custom]
    .sort((a, b) => a.version.localeCompare(b.version))
  const dup = migrations.find((m, i) => i > 0 && m.version === migrations[i - 1].version)
  if (dup) return { error: 'duplicate_version', apply: [], duplicate: dup.version }
  if (!dbIsFresh && applied.size === 0) return { error: 'baseline_missing', apply: [] }
  const apply = migrations.filter((m) => !applied.has(m.version))
  // L4: guard fora-de-ordem POR NAMESPACE. Sob disciplina expand-only os números só
  // sobem; uma pendente ABAIXO da última já aplicada é quase certamente erro de
  // empacotamento (rodaria DEPOIS de migrations de número maior). O max é por
  // namespace — um max GLOBAL faria a primeira custom aplicada (9xxx) acusar TODA
  // oficial futura (< 9000) como fora de ordem. Sinaliza, mas NÃO recusa (não brica
  // o boot num edge) — o main() só avisa e aplica mesmo assim.
  const appliedVersions = [...applied]
  const maxOf = (versions) =>
    versions.length > 0 ? versions.sort((a, b) => a.localeCompare(b)).pop() : null
  const maxOficial = maxOf(appliedVersions.filter((v) => !isCustomerVersion(v)))
  const maxCustom = maxOf(appliedVersions.filter((v) => isCustomerVersion(v)))
  const outOfOrder = apply
    .filter((m) => {
      const max = m.origem === 'custom' ? maxCustom : maxOficial
      return max !== null && m.version.localeCompare(max) < 0
    })
    .map((m) => m.version)
  return { error: null, apply, outOfOrder }
}

/**
 * PURA: a porta 6543 é a convenção de pgbouncer/supavisor para o modo TRANSACTION,
 * e o runner não funciona nele: o `pg_advisory_lock` é por SESSÃO, e em modo
 * transaction cada statement pode cair num backend diferente — a trava que serializa
 * dois containers subindo ao mesmo tempo quebraria EM SILÊNCIO.
 *
 * Isto detecta apenas a CONVENÇÃO de porta; um pooler em modo transaction noutra
 * porta passa batido. É o que dá para saber sem interrogar o pooler, e o custo de
 * errar para o lado permissivo é o mesmo de antes da migração.
 *
 * Ancorado no segmento de PORTA (antes de /path, ?query ou fim), para não casar com
 * um 6543 que esteja dentro da senha ou do nome do banco.
 */
export function ehPortaDeTransacao(dbUrl) {
  if (typeof dbUrl !== 'string') return false
  return /:6543([/?]|$)/.test(dbUrl)
}

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.log('[migrate] DATABASE_URL ausente — pulando (migrations seguem no fluxo manual).')
    return 0
  }
  if (ehPortaDeTransacao(dbUrl)) {
    console.error('[migrate] DATABASE_URL usa a porta 6543, a convenção do pooler em modo transaction — incompatível com o runner (o advisory lock é por sessão). Use a conexão direta do Postgres, normalmente na 5432. Ver DEPLOY.md §2.1.')
    return 1
  }
  const { default: postgres } = await import('postgres')
  // TLS obrigatório fora de localhost. `sslmode` explícito na URL continua mandando:
  // um Postgres no mesmo compose, sem certificado, precisa de `?sslmode=disable`.
  const local = /127\.0\.0\.1|localhost|\/\/[^@/]*@?postgres[:/]/.test(dbUrl)
  const pedeSemTls = /[?&]sslmode=(disable|allow)/.test(dbUrl)
  const sql = postgres(dbUrl, {
    max: 1,
    ssl: local || pedeSemTls ? false : 'require',
    prepare: false,
    onnotice: (n) => console.log('[migrate] pg:', n.severity ?? 'NOTICE', n.message), // default despeja o objeto cru e enterra o log de boot
  })
  try {
    // #11: conexão inicial com retry curto e limitado. postgres.js conecta lazy — o
    // `select 1` é a sonda de conectividade (sem efeito colateral) e é a ÚNICA coisa que
    // retentamos: um soluço transitório do banco no boot não deve virar exit 1 (crashloop)
    // numa instalação nova. Depois da sonda, falha de migration é erro real → exit 1 (sem
    // retry). URL com typo permanente esgota as tentativas e sai 1 (correto).
    const attempts = Math.max(1, Number(process.env.MIGRATE_CONNECT_ATTEMPTS) || 3)
    for (let i = 1; ; i++) {
      try {
        await sql`select 1`
        break
      } catch (err) {
        if (i >= attempts) throw err
        const backoff = 1000 * i // 1s, 2s, …
        console.warn(`[migrate] conexão falhou (tentativa ${i}/${attempts}: ${err?.message ?? err}) — novo teste em ${backoff}ms`)
        await new Promise((r) => setTimeout(r, backoff))
      }
    }
    // L3: lock_timeout ANTES do pg_advisory_lock — assim a própria espera pela trava
    // (não só o DDL) fica limitada a 15s. Se um boot concorrente segura a trava e trava,
    // este boot não espera pra sempre: expira → exit 1 → EasyPanel mantém/retenta o antigo.
    // (Sem statement_timeout: um backfill legítimo longo não pode ser morto.)
    await sql.unsafe(`set lock_timeout = '15s'`)
    await sql`select pg_advisory_lock(${LOCK_KEY})`

    // 🔴 HERANÇA DE NOME: o ledger já se chamou `awave_migrations`. Renomeia ANTES de
    // qualquer leitura — sem isto, um banco que já rodava veria o ledger novo vazio, e
    // `planMigrations` recusaria o boot com `baseline_missing` (banco com tabelas do CRM
    // e nenhuma migration registrada). Idempotente nos dois sentidos: não faz nada se o
    // nome antigo não existe, nem se o novo já existe.
    await sql.unsafe(`
      do $$
      begin
        if to_regclass('public.awave_migrations') is not null
           and to_regclass('public.pharma_migrations') is null then
          alter table public.awave_migrations rename to pharma_migrations;
          raise notice '[migrate] ledger renomeado de awave_migrations para pharma_migrations';
        end if;
      end $$;
    `)

    await sql`create table if not exists public.pharma_migrations (
      version text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    )`
    const sentinel = await sql`select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'sync_state'`
    const applied = new Set((await sql`select version from public.pharma_migrations`).map((r) => r.version))
    const dir = join(dirname(fileURLToPath(import.meta.url)), 'db', 'migrations')
    const files = await readdir(dir)
    // Zona do comprador: custom/migrations (faixa 9000+). Pasta ausente/deletada =
    // lista vazia, SEM ENOENT — o boot NUNCA morre por falta da pasta custom.
    // Só ENOENT é tolerado: EACCES/EIO subiriam o container SEM as migrations do
    // cliente em silêncio — nesses casos, falha (container antigo segue no ar).
    const customDir = join(dirname(fileURLToPath(import.meta.url)), 'custom', 'migrations')
    const customFiles = await readdir(customDir).catch((err) => {
      if (err?.code === 'ENOENT') return []
      throw err // dir EXISTE mas não lê → exit 1 via main().catch; container antigo segue no ar
    })
    for (const name of [...files, ...customFiles]) {
      // só .sql fora do padrão avisa — LEIA-ME.md e afins passam em silêncio
      if (name.endsWith('.sql') && !parseMigrationFile(name)) {
        console.warn('[migrate] ignorando arquivo fora do padrão: ' + name)
      }
    }
    const plan = planMigrations({ files, customFiles, applied, dbIsFresh: sentinel.length === 0 })
    if (plan.error === 'custom_fora_da_faixa') {
      console.error(
        `[migrate] Migration em custom/migrations fora da faixa reservada (9000–9999): ${plan.arquivo}. ` +
        'Renomeie pro prefixo 9000+ e reinicie. (Numa atualização, o container atual continua no ar até isso ser corrigido.)'
      )
      return 1
    }
    if (plan.error === 'oficial_na_faixa_custom') {
      console.error(
        `[migrate] Migration OFICIAL (db/migrations) dentro da faixa reservada ao cliente (9000–9999): ${plan.arquivo}. ` +
        'Isso é erro de empacotamento da release — migrations oficiais usam prefixo abaixo de 9000. ' +
        '(Numa atualização, o container atual continua no ar até isso ser corrigido.)'
      )
      return 1
    }
    if (plan.error === 'duplicate_version') {
      // faixas disjuntas (oficial < 9000, custom >= 9000) → a duplicata é sempre
      // DENTRO de uma pasta só; aponte a certa pro comprador não caçar na errada
      const pastaDup = isCustomerVersion(plan.duplicate) ? 'custom/migrations' : 'db/migrations'
      console.error(
        `[migrate] Versão duplicada nas migrations: ${plan.duplicate} — ` +
        `dois arquivos em ${pastaDup} com o mesmo prefixo. Corrija antes de subir.`
      )
      return 1
    }
    if (plan.error === 'baseline_missing') {
      console.error(
        '[migrate] Banco existente sem baseline (public.pharma_migrations vazia). ' +
        'Aplique as migrations pendentes manualmente UMA última vez — até a migration de ' +
        'baseline (a que cria public.pharma_migrations) — e rebuilde (DEPLOY.md §7).'
      )
      return 1
    }
    if (plan.outOfOrder && plan.outOfOrder.length > 0) {
      console.warn(
        '[migrate] AVISO: migration(s) fora de ordem (abaixo da última aplicada): ' +
        plan.outOfOrder.join(', ') + ' — verifique o empacotamento'
      )
    }
    if (plan.apply.length === 0) {
      console.log('[migrate] Nenhuma migration pendente.')
      return 0
    }
    for (const m of plan.apply) {
      const content = await readFile(join(m.origem === 'custom' ? customDir : dir, m.name), 'utf8')
      console.log(`[migrate] Aplicando ${m.name}…`)
      await sql.begin(async (tx) => {
        await tx.unsafe(content)
        await tx`insert into public.pharma_migrations (version, name)
          values (${m.version}, ${m.name}) on conflict (version) do nothing`
      })
    }
    console.log(`[migrate] OK — ${plan.apply.length} migration(s) aplicada(s).`)
    return 0
  } finally {
    await sql.end({ timeout: 5 })
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('[migrate] ERRO:', err?.message ?? err)
      process.exit(1) // falha → container não sobe → EasyPanel mantém o antigo servindo
    })
}
