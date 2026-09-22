# Design System — Pharma CRM

> **Fonte da verdade:** [`src/app/globals.css`](../src/app/globals.css). Este documento resume
> os tokens, as regras e os componentes; os valores de contraste citados foram medidos e estão
> comentados ao lado de cada token no próprio CSS. Em caso de divergência, **vale o CSS**.

---

## 1. Princípios

1. **Só token, nunca hex solto.** Componentes referenciam apenas `var(--…)`. Precisa de um
   valor diferente por tema? Peça um **token novo** no `globals.css` — nunca escreva
   `[data-tema="claro"] .minhaClasse` num módulo.
2. **Escuro é o padrão.** O `:root` é o tema escuro completo; o claro vive em
   `:root[data-tema="claro"]` e redefine **só cor e elevação**. Se a leitura da preferência
   falhar, a página cai no escuro — nunca numa tela sem cor.
3. **Tudo tem caixa.** Todo bloco de conteúdo é um **painel** (ver §4).
4. **Acessibilidade é medida, não estimada.** Todo par texto × superfície passa AA (4,5:1) no
   **pior** chão em que pode cair, nos dois temas. Há barreira de teste que lê os hex do disco.
5. **Poucos degraus.** 5 tamanhos de fonte, 4 raios, 8 espaços, 3 durações. Secundário se diz
   por **cor**, não por tamanho.
6. **Papel, não peso.** Tokens nomeados pelo que fazem (`--acento-hover`), não por
   intensidade (`--acento-forte`), porque a direção muda entre os temas.

---

## 2. Cor

### 2.1 Superfícies — três camadas, do chão para o que flutua

| Token | Escuro | Claro | Papel |
|---|---|---|---|
| `--fundo` | `#08080B` | `#F7F7F9` | A página, o chão |
| `--superficie` | `#101016` | `#FFFFFF` | Painel, cartão, drawer, campo editável |
| `--superficie-alta` | `#17171F` | `#FAFAFB` | O que se levanta dentro do painel (popover, cartão do kanban) |
| `--superficie-hover` | `#17171F` | `#F4F4F7` | Hover de linha de lista |
| `--trilho` | `#1F1F29` | `#F2F2F6` | O **poço**: segmented, coluna do kanban, badge, campo não-editável |
| `--trilho-hover` | `#26262F` | `#E8E8EE` | Hover do poço |

Os cinzas do escuro têm um **viés frio mínimo** (saturação baixa). A diferença entre camadas é
pequena de propósito — quem delimita objeto é `--linha-forte` (e `--realce` no escuro). No claro
a elevação **não** se diz por cor de superfície: use `--elev-*` e borda.

### 2.2 Linhas e realce

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| `--linha` | `rgba(255,255,255,.075)` | `rgba(11,11,20,.09)` | Divisor que se repete (lista, tabela), borda de painel |
| `--linha-forte` | `rgba(255,255,255,.13)` | `rgba(11,11,20,.15)` | Borda do que **contém**: input, cartão, drawer |
| `--realce` | `rgba(255,255,255,.06)` | `transparent` | Filete interno de luz no topo do elevado (`inset 0 1px 0`) |

### 2.3 Texto — três tons, sem quarto "sutil"

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| `--tinta` | `#F6F6F8` | `#0B0B12` | Títulos, valores, texto principal |
| `--tinta-2` | `#A2A2B0` | `#5A5A68` | Corpo (cor padrão do `body`) |
| `--tinta-3` | `#90909C` | `#636374` | Metadado, rótulo, ícone que informa sozinho |
| `--tinta-invertida` | `#0B0B12` | `#FFFFFF` | Texto sobre cor cheia do tema (botão primário/destrutivo) |
| `--tinta-sobre-derivado` | `#FFFFFF` | `#FFFFFF` | Texto sobre chão **derivado** (avatar) |
| `--polegar` | `#FFFFFF` | `#FFFFFF` | Polegar do interruptor |
| `--icone-mudo` | `#7A7A88` | `#77778A` | Ícone **decorativo**, sempre com rótulo ao lado (piso 3:1) |

Os três tons passam AA nas **cinco** superfícies (incluindo `--trilho` e `--trilho-hover`).
Qualquer cinza mais claro que `--tinta-3` é linha ou ícone — nunca texto.

> ⚠️ No escuro, `--tinta-invertida` é **escura**: nenhum acento consegue ser legível como texto
> e ter branco legível por cima ao mesmo tempo. Isso define a forma da rampa de acento.

### 2.4 Acento

| Token | Escuro | Claro |
|---|---|---|
| `--acento` | `#8B72FF` | `#6743F5` |
| `--acento-hover` | `#9B84FF` (clareia) | `#5B3EE8` (escurece) |
| `--acento-ativo` | `#A594FF` | `#4A2FD1` |
| `--acento-wash` | `rgba(139,114,255,.08)` | `rgba(103,67,245,.07)` |
| `--acento-linha` | `rgba(139,114,255,.30)` | `rgba(103,67,245,.28)` |

- Escuro: a rampa **clareia** a cada estado; claro: **escurece**. Os nomes descrevem o estado
  da interação, não o peso.
- `-wash` = fundo de chip, seleção e hover suave. O par *cor sobre o próprio wash* é
  obrigatório passar 4,5:1 no pior chão. **Mexeu na cor, meça o wash; mexeu no wash, meça a cor.**
- O acento é **substituível pela cor de marca** do comprador (§8).

### 2.5 Semânticos

| Token | Escuro | Claro | Wash |
|---|---|---|---|
| `--ok` | `#00D492` | `#007A52` | `--ok-wash` |
| `--erro` | `#FF6B6B` | `#C92D2D` | `--erro-wash` |
| `--aviso` | `#FFB224` | `#9B5C00` | `--aviso-wash` |

O mesmo valor serve para texto, ponto e barra. Os `-wash` saem por
`color-mix(in srgb, var(--x) 8%|7%, transparent)` — acompanham a cor sozinhos.

### 2.6 Cores de dado e de marca (iguais nos dois temas)

| Token | Valor | Uso |
|---|---|---|
| `--rampa-fim` | `#00C2A8` | Fim da rampa do funil (início = acento/marca). Espelhado em `src/lib/rampa.ts`. **É dado, não texto.** |
| `--marca-fim` | `#6E4BFF` | Ponta do degradê do lockup de marca. Não é cor de interface. |

**Paleta de etapas** (`src/lib/cores-etapa.ts`) — escolha fechada, não é token de tema:

| Cinza | Azul | Roxo | Âmbar | Verde | Rosa | Ciano | Laranja |
|---|---|---|---|---|---|---|---|
| `#94a3b8` | `#60a5fa` | `#a78bfa` | `#fbbf24` | `#34d399` | `#f472b6` | `#38bdf8` | `#f59e0b` |

**Avatar** (`src/lib/avatar.ts`): degradê derivado do nome (360 matizes), lightness escolhida
para garantir 4,5:1 contra branco.

### 2.7 Véu e elevação

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| `--veu` | `rgba(0,0,0,.7)` | `rgba(11,11,20,.32)` | Scrim atrás de drawer e nav mobile |
| `--elev-1` | `0 1px 2px rgba(0,0,0,.5)` | `0 1px 2px rgba(11,11,20,.06)` | Repouso de painel e cartão |
| `--elev-2` | `0 2px 4px …, 0 12px 32px …` | idem, mais fraco | O que flutua de verdade: popover, drawer, menu |

---

## 3. Tipografia

**Família:** Geist Variable (local, `src/fontes/`), exposta como `--font-sans` pelo
`next/font` no `<html>`. **Não redefina `--font-sans` no CSS** — isso mata o fallback com
métricas ajustadas.

### 3.1 Escala — cinco tamanhos

| Papel | `--fs-*` | `--lh-*` | `--ls-*` | Uso |
|---|---|---|---|---|
| `micro` | 11px | 1.3 | 0.08em | Caixa alta: pill, cabeçalho de tabela/raia |
| `body` | 13px | 1.45 | 0 | Todo texto de interface (padrão do `body`) |
| `title` | 16px | 1.3 | −0.015em | Título de drawer/seção |
| `page` | 24px | 1.2 | −0.03em | Título de página (único elemento fora das caixas) |
| `metric` | 29px | 1.05 | −0.04em | Número de KPI |

Nenhum passo abaixo de 1,18. Quanto maior o corpo, mais negativo o tracking; caixa alta
pequena é o único lugar com tracking **positivo**.

### 3.2 Tracking de rótulos em caixa alta (11px)

| Token | Valor | Uso |
|---|---|---|
| `--ls-micro` | 0.08em | Cabeçalho de raia do kanban e de tabela (texto de tamanho imprevisível) |
| `--ls-rotulo-metrica` | 0.11em | Rótulo do `KpiCard` |
| `--ls-rotulo-secao` | 0.13em | Seção da navegação ("DIA A DIA", "CADASTROS") |

### 3.3 Pesos
**400 / 500 / 600.** 700 só no lockup de marca. `<b>`/`<strong>` são forçados a 600 no global.
Números em métricas e deltas usam `font-variant-numeric: tabular-nums`.

---

## 4. Contenção — a regra do painel

**Todo bloco de conteúdo é um painel**, sempre com os quatro juntos:

```css
background: var(--superficie);
border: 1px solid var(--linha);
border-radius: var(--r-painel);
box-shadow: var(--elev-1);
```

- O **rail** (barra lateral) também é painel: flutua com folga de 12px, não encosta na janela.
- **Não** ganham caixa: linha de lista, célula de tabela, rótulo, chip.
- Nada de caixa dentro de caixa: o cartão do kanban usa `--superficie-alta` **dentro** da
  coluna (`--trilho`), não um segundo painel igual.
- Entre blocos, o espaço é só o `gap` do container (12px). Um `margin-bottom` somando com o
  gap é resto da regra antiga.
- Padding de painel sai da escala: `--s-5` (16) no corpo, `--s-4`/`--s-3` no cabeçalho.

---

## 5. Espaço, raio, densidade e layout

### 5.1 Espaço — escala de 4px

| `--s-1` | `--s-2` | `--s-3` | `--s-4` | `--s-5` | `--s-6` | `--s-7` | `--s-8` |
|---|---|---|---|---|---|---|---|
| 2px | 4px | 8px | 12px | 16px | 24px | 32px | 48px |

### 5.2 Raio

| Token | Valor | Uso |
|---|---|---|
| `--r-pequeno` | 6px | Tile de ícone, thumb, barra, botão pequeno |
| `--r-controle` | 10px | Botão, input, select, chip |
| `--r-painel` | 14px | Card, painel, poço, drawer, rail |
| `--r-pill` | 999px | Avatar, pill, badge de contagem |

### 5.3 Densidade

| Token | Valor | Uso |
|---|---|---|
| `--h-row` | 36px | Linha de lista/tabela |
| `--h-nav` | 30px | Item de navegação |
| `--h-control` | 32px | Botão, input, select |

### 5.4 Layout

| Token | Valor | Uso |
|---|---|---|
| `--barra-w` | 244px | Largura do rail |
| `--content-max` | 1440px | Teto do conteúdo |
| `--pad-page` / `--gutter` | 24 / 16px | Moldura para página **sem** painel (hoje sem uso — não reintroduzir no shell) |

**Shell** (`app-shell.module.css`): grid `244px 1fr`, padding `--s-4`, fundo `--fundo`;
conteúdo em coluna com `gap: --s-4`, centralizado até `--content-max`. Abaixo de **1024px** o
rail sai e entra a navegação mobile (gaveta com `--veu`).

---

## 6. Movimento

| Token | Valor | Uso |
|---|---|---|
| `--t-rapido` | .14s | Hover e foco |
| `--t-medio` | .28s | Troca de estado, entrada de item |
| `--t-lento` | .85s | Revelação de dado (barra crescendo) |
| `--t-pulso` | 2.4s | Único ciclo ambiente (indicador persistente) |
| `--mola` | `cubic-bezier(.16,1,.3,1)` | Chegada — o que faz o elemento "pousar" |
| `--suave` | `cubic-bezier(.4,0,.2,1)` | Cor e opacidade |

Utilitários em `src/app/movimento.module.css`:

| Classe | Efeito |
|---|---|
| `.entra` | Fade + sobe 9px com `--mola` |
| `.escalona` | Atraso por índice (`--i` × 45ms, teto 360ms) |
| `.cresce` | Largura de 0 ao valor, `--t-lento` |
| `.pulsa` | Shimmer do esqueleto de carregamento |

**Regras:** duração literal em `transition`/`animation` de módulo é reprovada pela barreira.
`prefers-reduced-motion: reduce` zera duração **e** atraso globalmente (`.01ms`, não `none`,
para eventos `*end` dispararem e `.entra` não ficar invisível). Animação em JS precisa checar
a preferência por conta própria.

---

## 7. Componentes

Todos em `src/components/ui/`, cada um com seu `.module.css`. Para customizações do comprador,
os componentes visuais são expostos por `@pharma/custom/ui`.

### 7.1 `Botao`
O vocabulário único de ação. Vira `<Link>` quando recebe `href`.

| Prop | Valores | Padrão |
|---|---|---|
| `variante` | `primario` · `secundario` · `fantasma` | `secundario` |
| `tom` | `ok` · `erro` | — (acento) |
| `tamanho` | `medio` · `pequeno` | `medio` |
| `soIcone`, `larguraTotal`, `carregando`, `desabilitado` | boolean | — |

- **primario:** fundo `--botao-cor`, texto `--tinta-invertida`; hover/ativo seguem a rampa.
- **secundario:** `--superficie` + borda `--linha-forte`, texto `--tinta-2`; hover pinta borda,
  wash e texto com a cor do tom.
- **fantasma:** transparente, `--tinta-3`; hover `--superficie-hover` + `--linha`.
- `tom` troca só os ganchos `--botao-cor/-hover/-ativo/-wash` — sem combinatória de classes.
- **Carregando** usa `aria-disabled="true"` (não `disabled`) para não perder o foco do teclado.
  Desabilitado: opacidade .55.

### 7.2 `Pill`
Status em caixa alta, 11px/600, raio pílula, ponto de 6px em `currentColor`.

| `variante` | Fundo | Texto |
|---|---|---|
| `ok` | `--ok-wash` | `--ok` |
| `aviso` | `--aviso-wash` | `--aviso` |
| `erro` | `--erro-wash` | `--erro` |
| `neutro` (padrão) | `--trilho` | `--tinta-3` |
| `accent` | `--acento-wash` | `--acento` |

### 7.3 Formulário — `Campo`, `Entrada`, `Selecao`, `AreaTexto`
`Campo` envolve rótulo, `ajuda`, `erro` e `obrigatorio`, ligando `aria-describedby` e
`aria-invalid`. Campo editável é **plano** (`--superficie` + `--linha-forte`), nunca poço
(poço lê como desabilitado). `<select>` e campos de data são nativos com pele do kit (chevron
`lucide`, `appearance: none`) definida uma vez no global.

### 7.4 Dados e painel

| Componente | Função |
|---|---|
| `KpiCard` | Rótulo (`--ls-rotulo-metrica`), número `--fs-metric`, `Delta`, `Sparkline`, nota |
| `Delta` | Seta + variação (`pct`/`pp`), `--ok` para cima e `--erro` para baixo, 13/500 |
| `Sparkline` | Minigráfico da série, com estado "sem série" |
| `ChartCard` | Painel de gráfico: título 13/600 `--tinta`, `meta` e `acao` à direita |
| `ListCard` | Painel de lista (avatar, título, subtítulo, pill, valor). Cabeçalho **idêntico ao pixel** ao do `ChartCard` |
| `CabecalhoPagina` | Título `--fs-page`, subtítulo, ações e slot `acima` |
| `EstadoVazio` | Ícone, título, texto e ação — texto em tom AA (nunca "sutil") |
| `Esqueleto` | Placeholder com `.pulsa`; `largura`, `altura`, `redondo` |

### 7.5 Navegação e sobreposição

| Componente | Função |
|---|---|
| `Rail` (`shell/`) | Painel lateral sticky com lockup de marca, seletor de workspace, grupos de navegação e menu do usuário. Brilho radial do acento a 17% no topo |
| `ItemNav` | Item de 30px com ícone lucide 16px / traço 2 |
| `NavMobile` | Gaveta de navegação < 1024px, com `--veu` |
| `SeletorWorkspace`, `MenuUsuario` | Popovers com `--elev-2` |
| `Drawer` | Gaveta lateral para formulários (`aberto`, `titulo`, `onFechar`), sobre `--veu` |
| `BarraDeAbas` | Abas tipadas (Configurações, Agentes) |
| `SeletorTema` | Segmented Claro/Escuro |
| `Avatar` | `sm` 24px / `md`; disco derivado do nome, borda translúcida |

### 7.6 Iconografia
**lucide-react**, 16px e traço 2 na navegação; 13px e traço 1.75 em deltas. Ícone que informa
sozinho usa `--tinta-3`; decorativo com rótulo ao lado pode usar `--icone-mudo`.

---

## 8. Marca do comprador

Configurada em **Configurações → Servidor → Marca** (só o dono) e salva no banco — sobrevive a
atualizações. Quatro campos: **nome, logo, favicon, cor**.

- A cor passa por um **portão de contraste** (mínimo 4,5:1) ao salvar; recusa com o valor medido.
- A partir dela, `src/lib/marca-cor.ts` **deriva** `hover`, `active`, `wash` e `line` —
  **duas vezes**, uma medida contra o fundo claro e outra contra o escuro — e injeta um
  `<style>` no `<head>` com especificidade igual à dos blocos de tema.
- Nunca ajuste marca editando token no CSS: só conserta o tema que você olhou.

---

## 9. Acessibilidade

- **Anel de foco único:** `outline: 2px solid var(--acento); outline-offset: 2px`, sempre o
  acento (mesmo em botão destrutivo).
- Contraste: texto ≥ 4,5:1 no pior chão; objeto gráfico e ícone ≥ 3:1 (WCAG 1.4.11).
- `color-scheme` por tema, para barra de rolagem, dropdown nativo, date picker e autofill
  seguirem o tema.
- Controles nativos preservados (teclado e leitor de tela intactos).
- Kanban anuncia arraste para leitor de tela; popups gerenciam foco (`foco-popup.ts`).
- Movimento reduzido honrado globalmente (§6).

---

## 10. Checklist para uma tela nova

- [ ] Só `var(--…)`; nenhum hex, nenhuma duração literal, nenhum `style={{}}` de cor.
- [ ] Nenhum seletor de tema dentro de módulo.
- [ ] Cada bloco é painel (superfície + linha + `--r-painel` + `--elev-1`); nada de caixa em caixa.
- [ ] Tamanhos de fonte só da escala de cinco; pesos 400/500/600.
- [ ] Espaços da escala de 4px; `gap` de 12px entre blocos.
- [ ] Ações com `Botao`; status com `Pill`; formulário com `Campo`.
- [ ] Estado vazio com `EstadoVazio`; carregamento com `Esqueleto`.
- [ ] Conferido nos dois temas e com "reduzir movimento" ligado.
- [ ] Foco visível por teclado em todo interativo.
