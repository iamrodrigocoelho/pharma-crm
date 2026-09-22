import { describe, expect, it, beforeAll, afterAll } from 'vitest'

// Testes contra um Postgres DE VERDADE. Sem `DATABASE_URL` eles são pulados, para
// que `pnpm test` continue rodando offline — mas quem mexer no construtor de
// consultas deve rodá-los com um banco migrado: são eles que provam que o SQL
// gerado não só está bem formado como devolve o mesmo FORMATO que o app espera
// (objeto para many-to-one, array para one-to-many, escalar para RPC escalar).
//
//   createdb pharma && DATABASE_URL=... node migrate.mjs
//   DATABASE_URL=... pnpm test

const URL_DO_BANCO = process.env.DATABASE_URL
const suite = URL_DO_BANCO ? describe : describe.skip

suite('construtor contra Postgres real', () => {
  let db: typeof import('@/server/db').db
  let encerrar: () => Promise<void>
  let ws = ''
  let usuarioId = ''

  beforeAll(async () => {
    const mod = await import('@/server/db')
    db = mod.db
    encerrar = (await import('@/server/db/conexao')).encerrarConexao

    const marca = Date.now()
    const u = await db()
      .from('usuarios')
      .insert({ email: `teste-${marca}@exemplo.test`, senha_hash: 'scrypt$x' })
      .select('id')
      .single()
    expect(u.error).toBeNull()
    usuarioId = (u.data as { id: string }).id

    const r = await db().rpc('criar_workspace', { nome: `WS ${marca}`, p_dono: usuarioId })
    expect(r.error).toBeNull()
    ws = r.data as string
  })

  afterAll(async () => {
    if (usuarioId) await db().from('usuarios').delete().eq('id', usuarioId)
    if (ws) await db().from('workspaces').delete().eq('id', ws)
    await encerrar()
  })

  it('RPC escalar devolve o VALOR, não uma linha', () => {
    expect(typeof ws).toBe('string')
    expect(ws).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('RPC `returns setof` devolve ARRAY', async () => {
    const { data, error } = await db().rpc('reservar_jobs', { p_limite: 1, p_frio: '1 minute' })
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('RPC `returns void` devolve null sem erro', async () => {
    const { data, error } = await db().rpc('incrementar_rejeicoes_canal', {
      p_ws: ws,
      p_canal: '00000000-0000-0000-0000-000000000000',
    })
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('insert + select devolve as colunas pedidas', async () => {
    const { data, error } = await db()
      .from('contatos')
      .insert({ workspace_id: ws, nome: 'Ana Teste', email: 'ana@exemplo.test' })
      .select('id, nome, email')
      .single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ nome: 'Ana Teste', email: 'ana@exemplo.test' })
  })

  it('grava e relê jsonb como objeto', async () => {
    const { data, error } = await db()
      .from('contatos')
      .insert({ workspace_id: ws, nome: 'Com Campos', campos: { cnpj: '123', tags: ['a', 'b'] } })
      .select('id, campos')
      .single()
    expect(error).toBeNull()
    expect((data as { campos: unknown }).campos).toEqual({ cnpj: '123', tags: ['a', 'b'] })
  })

  it('embed many-to-one vem como OBJETO (e null quando não há)', async () => {
    const emp = await db()
      .from('empresas')
      .insert({ workspace_id: ws, nome: 'Empresa X' })
      .select('id')
      .single()
    const empresaId = (emp.data as { id: string }).id

    await db().from('contatos').insert({ workspace_id: ws, nome: 'Com Empresa', empresa_id: empresaId })

    const { data, error } = await db()
      .from('contatos')
      .select('nome, empresas(nome)')
      .eq('workspace_id', ws)
      .eq('nome', 'Com Empresa')
      .single()
    expect(error).toBeNull()
    expect((data as { empresas: unknown }).empresas).toEqual({ nome: 'Empresa X' })

    const semEmpresa = await db()
      .from('contatos')
      .select('nome, empresas(nome)')
      .eq('workspace_id', ws)
      .eq('nome', 'Ana Teste')
      .single()
    expect((semEmpresa.data as { empresas: unknown }).empresas).toBeNull()
  })

  it('embed one-to-many vem como ARRAY (e [] quando vazio)', async () => {
    const { data, error } = await db()
      .from('empresas')
      .select('nome, contatos(nome)')
      .eq('workspace_id', ws)
      .eq('nome', 'Empresa X')
      .single()
    expect(error).toBeNull()
    expect((data as { contatos: unknown[] }).contatos).toEqual([{ nome: 'Com Empresa' }])

    const vazia = await db()
      .from('empresas')
      .insert({ workspace_id: ws, nome: 'Empresa Vazia' })
      .select('id')
      .single()
    const semContato = await db()
      .from('empresas')
      .select('nome, contatos(nome)')
      .eq('id', (vazia.data as { id: string }).id)
      .single()
    expect((semContato.data as { contatos: unknown[] }).contatos).toEqual([])
  })

  it('embed de contagem vem como [{count}]', async () => {
    const { data, error } = await db()
      .from('empresas')
      .select('nome, contatos(count)')
      .eq('workspace_id', ws)
      .eq('nome', 'Empresa X')
      .single()
    expect(error).toBeNull()
    expect((data as { contatos: unknown }).contatos).toEqual([{ count: 1 }])
  })

  it('count exact com head não traz linhas e ignora limit', async () => {
    const { data, count, error } = await db()
      .from('contatos')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws)
      .limit(1)
    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(count).toBe(3)
  })

  it('upsert atualiza sem duplicar', async () => {
    await db().from('settings').upsert({ key: 'teste_upsert', value: 'a' }, { onConflict: 'key' })
    await db().from('settings').upsert({ key: 'teste_upsert', value: 'b' }, { onConflict: 'key' })
    const { data } = await db().from('settings').select('value').eq('key', 'teste_upsert').single()
    expect((data as { value: string }).value).toBe('b')
    await db().from('settings').delete().eq('key', 'teste_upsert')
  })

  it('maybeSingle devolve null sem erro; single sem linha devolve PGRST116', async () => {
    const talvez = await db().from('contatos').select('id').eq('id', '00000000-0000-0000-0000-000000000000').maybeSingle()
    expect(talvez.error).toBeNull()
    expect(talvez.data).toBeNull()

    const exato = await db().from('contatos').select('id').eq('id', '00000000-0000-0000-0000-000000000000').single()
    expect(exato.error?.code).toBe('PGRST116')
  })

  it('violação de unicidade chega como SQLSTATE 23505, não como exceção', async () => {
    const { error } = await db()
      .from('usuarios')
      .insert({ email: (await db().from('usuarios').select('email').eq('id', usuarioId).single()).data.email, senha_hash: 'x' })
    expect(error?.code).toBe('23505')
  })

  it('filtra dentro de jsonb com ->>', async () => {
    const { data, error } = await db()
      .from('contatos')
      .select('nome')
      .eq('workspace_id', ws)
      .not('campos->>cnpj', 'is', null)
    expect(error).toBeNull()
    expect(data).toEqual([{ nome: 'Com Campos' }])
  })

  it('in, order e range cooperam', async () => {
    const { data, error } = await db()
      .from('contatos')
      .select('nome')
      .eq('workspace_id', ws)
      .in('nome', ['Ana Teste', 'Com Campos', 'Com Empresa'])
      .order('nome', { ascending: true })
      .range(0, 1)
    expect(error).toBeNull()
    expect(data).toEqual([{ nome: 'Ana Teste' }, { nome: 'Com Campos' }])
  })

  it('busca vetorial aceita o embedding no formato literal do pgvector', async () => {
    // Regressão: array JS vira ARRAY DO POSTGRES no driver e o pgvector recusa.
    // O app converte em `[a,b,c]` antes de chamar (ver src/server/agente/busca-base.ts).
    const vetor = Array.from({ length: 1536 }, () => 0.1)
    const { error } = await db().rpc('base_conhecimento_buscar', {
      p_ws: ws,
      p_query: 'teste',
      p_embedding: `[${vetor.join(',')}]`,
      p_versao: 'v1',
      p_limite: 5,
      p_tipos: null,
      p_assistente: null,
    })
    expect(error).toBeNull()

    const cru = await db().rpc('base_conhecimento_buscar', {
      p_ws: ws, p_query: 'teste', p_embedding: vetor, p_versao: 'v1',
      p_limite: 5, p_tipos: null, p_assistente: null,
    })
    expect(cru.error?.message).toMatch(/invalid input syntax for type vector|sintaxe de entrada é inválida/)
  })

  it('embedding nulo (sem chave de IA) não quebra a busca', async () => {
    const { error } = await db().rpc('base_conhecimento_buscar', {
      p_ws: ws, p_query: 'teste', p_embedding: null, p_versao: null,
      p_limite: 5, p_tipos: null, p_assistente: null,
    })
    expect(error).toBeNull()
  })

  it('o gatilho do inbox publica NOTIFY no commit', async () => {
    const { conexao } = await import('@/server/db/conexao')
    const recebidos: string[] = []
    const escuta = await conexao().listen('pharma_inbox', (p) => void recebidos.push(p))

    const contato = await db()
      .from('contatos')
      .insert({ workspace_id: ws, nome: 'Para Notificar' })
      .select('id')
      .single()
    const canal = await db()
      .from('canais')
      .insert({ workspace_id: ws, provider: 'simulador', nome: 'Canal Teste', config: {} })
      .select('id')
      .single()
    expect(canal.error).toBeNull()

    const conversa = await db()
      .from('conversas')
      .insert({
        workspace_id: ws,
        canal_id: (canal.data as { id: string }).id,
        contato_id: (contato.data as { id: string }).id,
        chave_externa: `teste-${Date.now()}`,
      })
      .select('id')
      .single()
    expect(conversa.error).toBeNull()

    await new Promise((r) => setTimeout(r, 300))
    expect(recebidos).toContain(ws)
    await escuta.unlisten()
  })

  it('chaveiro: grava cifrado, lê em claro, e o banco NÃO guarda o texto', async () => {
    process.env.PHARMA_SECRETS_KEY = 'chave-de-teste-do-chaveiro-com-bastante-tamanho'
    const { getSecret, setSecret, deleteSecret } = await import('@/server/secrets')

    expect(await setSecret('teste_token', 'EAAG-token-secreto-123')).toBe(true)
    expect(await getSecret('teste_token')).toBe('EAAG-token-secreto-123')

    const bruto = await db().from('segredos').select('valor_cifrado').eq('nome', 'teste_token').single()
    const guardado = (bruto.data as { valor_cifrado: string }).valor_cifrado
    expect(guardado).not.toContain('EAAG-token-secreto-123')
    expect(guardado.startsWith('v1.')).toBe(true)

    // Regravar troca o valor sem duplicar a linha.
    await setSecret('teste_token', 'outro-valor')
    expect(await getSecret('teste_token')).toBe('outro-valor')

    await deleteSecret('teste_token')
    expect(await getSecret('teste_token')).toBeNull()
  })

  it('chaveiro: chave trocada devolve null em vez de lixo', async () => {
    process.env.PHARMA_SECRETS_KEY = 'primeira-chave-do-chaveiro-com-tamanho-ok'
    const mod = await import('@/server/secrets')
    await mod.setSecret('teste_rotacao', 'valor-original')

    process.env.PHARMA_SECRETS_KEY = 'SEGUNDA-chave-completamente-diferente-daqui'
    // GCM autentica: texto cifrado que não abre com esta chave falha a tag em vez de
    // decifrar para lixo que o app usaria como token.
    expect(await mod.getSecret('teste_rotacao')).toBeNull()

    process.env.PHARMA_SECRETS_KEY = 'primeira-chave-do-chaveiro-com-tamanho-ok'
    expect(await mod.getSecret('teste_rotacao')).toBe('valor-original')
    await mod.deleteSecret('teste_rotacao')
  })

  it('chaveiro: registro adulterado no banco não decifra', async () => {
    process.env.PHARMA_SECRETS_KEY = 'chave-para-o-teste-de-adulteracao-aqui-ok'
    const mod = await import('@/server/secrets')
    await mod.setSecret('teste_adulterado', 'valor-intacto')

    const atual = await db().from('segredos').select('valor_cifrado').eq('nome', 'teste_adulterado').single()
    const partes = (atual.data as { valor_cifrado: string }).valor_cifrado.split('.')
    // Vira um bit do corpo cifrado mantendo o formato.
    partes[2] = partes[2].slice(0, -2) + (partes[2].slice(-2) === 'AA' ? 'BB' : 'AA')
    await db().from('segredos').update({ valor_cifrado: partes.join('.') }).eq('nome', 'teste_adulterado')

    expect(await mod.getSecret('teste_adulterado')).toBeNull()
    await mod.deleteSecret('teste_adulterado')
  })

  it('chaveiro: o nome ANTIGO da variável (AWAVE_SECRETS_KEY) continua valendo', async () => {
    // A troca de marca renomeou as variáveis para PHARMA_*, mas um deploy que já
    // esteja no ar tem as antigas coladas no painel. Se esta queda parar de existir,
    // esse deploy sobe e NÃO consegue mais abrir o chaveiro — os tokens de canal e a
    // chave de IA viram texto ilegível, sem erro de boot que explique o motivo.
    delete process.env.PHARMA_SECRETS_KEY
    process.env.AWAVE_SECRETS_KEY = 'chave-pelo-nome-antigo-com-tamanho-suficiente'
    const mod = await import('@/server/secrets')
    await mod.setSecret('teste_nome_antigo', 'valor-pelo-nome-antigo')
    expect(await mod.getSecret('teste_nome_antigo')).toBe('valor-pelo-nome-antigo')

    // E o nome novo tem precedência quando os dois estão definidos.
    process.env.PHARMA_SECRETS_KEY = 'chave-pelo-nome-novo-completamente-diferente'
    expect(await mod.getSecret('teste_nome_antigo')).toBeNull()

    delete process.env.PHARMA_SECRETS_KEY
    await mod.deleteSecret('teste_nome_antigo')
    delete process.env.AWAVE_SECRETS_KEY
  })
})
