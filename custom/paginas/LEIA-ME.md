# `custom/paginas/` — telas suas

Uma pasta por tela, com um arquivo `pagina.tsx` dentro. O caminho vira a URL:

```
custom/paginas/financeiro/pagina.tsx          →  /x/financeiro
custom/paginas/financeiro/contratos/pagina.tsx →  /x/financeiro/contratos
```

O endereço começa com **`/x/`** e isso não é opcional: é o espaço reservado pra você. Assim
uma tela nova do CRM nunca colide com uma sua numa atualização.

⚠️ **O arquivo tem que se chamar exatamente `pagina.tsx`** — com esse nome e com essa
extensão. `pagina.ts`, `pagina.jsx` ou `page.tsx` não são encontrados, e o endereço responde
"não encontrado" sem nenhum outro aviso.

## O mínimo que funciona

```tsx
// custom/paginas/financeiro/pagina.tsx
export const meta = { titulo: 'Financeiro' }   // opcional: o título da aba do navegador

export default function Financeiro() {
  return <h1>Financeiro</h1>
}
```

Depois é só abrir `/x/financeiro`. Para o item aparecer no menu lateral, adicione uma linha
em `custom/menu.ts`.

## Com dados e com a cara do produto

```tsx
import { usarSessao, clienteDaSessao } from '@pharma/custom'
import { CabecalhoPagina, KpiCard, EstadoVazio } from '@pharma/custom/ui'

export const meta = { titulo: 'Contratos' }

export default async function Contratos() {
  const { workspaceId } = await usarSessao()
  const db = await clienteDaSessao()

  // Sua tabela, criada em custom/migrations/ com workspace_id (ver ../LEIA-ME.md).
  // 🔴 O filtro por espaço de trabalho é SEU: sem o .eq(), aparecem os contratos de
  // todos os clientes hospedados neste servidor.
  const { data } = await db
    .from('meus_contratos')
    .select('id, titulo, valor')
    .eq('workspace_id', workspaceId)

  if (!data?.length) {
    return (
      <>
        <CabecalhoPagina titulo="Contratos" />
        <EstadoVazio icone={null} titulo="Nenhum contrato" texto="Cadastre o primeiro." />
      </>
    )
  }

  return (
    <>
      <CabecalhoPagina titulo="Contratos" subtitulo={`${data.length} no total`} />
      <KpiCard label="Contratos" valor={String(data.length)} />
    </>
  )
}
```

## O que vale saber

- **A página já vem logada.** Ela roda dentro do mesmo shell do CRM: menu lateral, sessão,
  espaço de trabalho ativo. Você não precisa checar login.
- **Precisa de botão, formulário, estado?** Ponha `'use client'` na primeira linha do
  componente que precisa disso — é React e Next normais.
- **Se a sua página quebrar, só ela quebra.** O resto do CRM continua funcionando. A mensagem do erro aparece na própria tela.
- **Importe só de `@pharma/custom`.** O que está em `src/` é interno do produto e muda sem
  aviso entre versões. A lista completa do que você pode importar está no `../LEIA-ME.md`.
