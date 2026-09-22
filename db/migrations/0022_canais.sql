-- 0022_canais.sql — canal de mensageria, conversas e mensagens.
--
-- ⚠️ ADITIVA. Migration que falha = container que NAO SOBE, em toda instalacao: o
-- EasyPanel mantem a versao anterior e o comprador fica sem entender por que a
-- atualizacao "nao pegou". Nada aqui exige ownership de tabela do Supabase.

create table if not exists public.canais (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('uazapi')),
  nome text not null,
  -- E.164, preenchido so depois do pareamento. Nulo ate la.
  telefone text,
  -- Id da instancia na conta do provider. Ver o indice unico GLOBAL abaixo.
  external_id text,
  status_conexao text not null default 'desconectado'
    check (status_conexao in ('desconectado', 'pareando', 'conectado', 'erro')),
  -- Nao-secreto: server_url, nome da instancia. Segredo mora no Vault.
  config jsonb not null default '{}'::jsonb,
  -- 🔴 Contador de eventos REPROVADOS pela camada 2 de verificacao. A rota devolve 200 nesses
  -- casos (500 faria o provider reenviar para sempre um evento que nunca sera aceito) — e 200
  -- MUDO, num endpoint com varios workspaces, e sensor desligado: quem sonda `external_id`
  -- com um segredo de caminho valido nao deixaria rastro nenhum. A tela mostra "N eventos
  -- rejeitados" quando passa de zero. O incremento e ATOMICO, por uma funcao propria.
  eventos_rejeitados int not null default 0,
  rejeitado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- 🔴 UNICO NO DEPLOY, contrariando a regra geral de "unico por workspace" de proposito.
-- `external_id` identifica uma instancia na conta do provider, que e do DEPLOY. Unico por
-- workspace deixaria dois canais de workspaces diferentes apontando para a mesma
-- instancia: a verificacao de evento passa nos dois e a MESMA conversa e gravada em dois
-- workspaces — vazamento por configuracao, sem exploit nenhum.
create unique index if not exists canais_external_id_key on public.canais (external_id)
  where external_id is not null;
create index if not exists canais_workspace_idx on public.canais (workspace_id);

create table if not exists public.conversas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  canal_id uuid not null references public.canais(id) on delete cascade,
  contato_id uuid references public.contatos(id) on delete set null,
  -- O chat id do provider.
  chave_externa text not null,
  status text not null default 'aberta' check (status in ('aberta', 'arquivada')),
  -- Ultima mensagem de QUALQUER direcao: ordena a lista da caixa de entrada.
  ultima_mensagem_em timestamptz,
  -- Ultima mensagem DO CLIENTE: e o relogio da janela de 24h e do follow-up automatico.
  -- As duas NAO sao redundantes; confundi-las faz o follow-up contar a partir da nossa
  -- propria mensagem, que e o erro que transforma "recuperar lead" em cobranca.
  ultima_msg_in_at timestamptz,
  nao_lidas int not null default 0,
  atribuida_a uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (workspace_id, canal_id, chave_externa)
);

-- 🔴 FK COMPOSTA, igual a negocios.responsavel_id (0004). FK simples para membros(id)
-- deixaria atribuir conversa a membro de OUTRO workspace. MATCH SIMPLE: nulo nao checa.
-- GUARDADA pelo `pg_constraint`, como as FKs compostas da 0025 e da 0028: `add constraint`
-- nao aceita `if not exists`, e num arquivo que declara tolerar objeto pre-existente ela
-- seria a instrucao que para a reexecucao no meio, com `42710`.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'conversas_atribuida_fk' and conrelid = 'public.conversas'::regclass
  ) then
    alter table public.conversas
      add constraint conversas_atribuida_fk
      foreign key (workspace_id, atribuida_a)
      references public.membros (workspace_id, id) on delete set null (atribuida_a);
  end if;
end $$;
create index if not exists conversas_workspace_idx on public.conversas (workspace_id);
create index if not exists conversas_lista_idx on public.conversas (workspace_id, status, ultima_mensagem_em desc);

create table if not exists public.mensagens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversa_id uuid not null references public.conversas(id) on delete cascade,
  -- Id da mensagem no provider. E a chave de idempotencia (indice abaixo) e o alvo do ack.
  externo_id text,
  direcao text not null check (direcao in ('entrada', 'saida')),
  autor text not null check (autor in ('contato', 'membro', 'aparelho')),
  texto text not null default '',
  midia jsonb,
  status text not null
    check (status in ('recebida', 'pendente', 'enviada', 'entregue', 'lida', 'falhou')),
  -- Timestamp do PROVIDER. A ordenacao da thread usa este, nunca o criado_em: sob retry
  -- e atraso, duas mensagens invertem.
  origem_em timestamptz not null,
  -- Fila de saida, no mesmo padrao do outbox da 0007, com predicado proprio.
  tentativas int,
  proxima_tentativa timestamptz,
  ultimo_erro text,
  desistido_em timestamptz,
  -- 🔴 Marcador de "em voo": gravado na reserva, limpo no desfecho. Existe porque
  -- proxima_tentativa NAO distingue "reservada, enviando agora" de "backoff agendado" —
  -- as duas sao timestamp futuro —, e sem a distincao o orfao da 2a tentativa em diante e
  -- REENVIADO ao cliente.
  enviando_desde timestamptz,
  criado_em timestamptz not null default now()
);

-- Idempotencia: webhook reenvia SEMPRE. Por workspace, como manda a convencao do repo.
create unique index if not exists mensagens_externo_id_key on public.mensagens (workspace_id, externo_id)
  where externo_id is not null;
create index if not exists mensagens_workspace_idx on public.mensagens (workspace_id);
-- A thread: ordenada por origem_em, sem coalesce (a coluna nasce junto, nao ha linha antiga).
create index if not exists mensagens_thread_idx on public.mensagens (conversa_id, origem_em desc);

-- ── contatos.telefone_sufixo ───────────────────────────────────────────────────────────
--
-- 🔴 CANDIDATO DE INDICE, NAO VEREDITO. Os 8 ultimos digitos servem para achar os poucos
-- candidatos sem varrer a tabela. Eles NAO decidem nada: 8 digitos descartam o nono
-- digito E O DDD JUNTO, entao (11) 99120-6753 e (14) 99120-6753 produzem o mesmo valor.
-- Casar contato por aqui funde duas pessoas diferentes num registro so, e isso nao se
-- desfaz. Quem decide e a comparacao de telefone do codigo, que canonicaliza o numero
-- inteiro antes de comparar.
--
-- Indice COMUM. Unico falharia ao aplicar — o comprador ja tem duplicatas de telefone, e
-- migration que falha e container que nao sobe.
alter table public.contatos add column if not exists telefone_sufixo text;

create index if not exists contatos_telefone_sufixo_idx
  on public.contatos (workspace_id, telefone_sufixo)
  where telefone_sufixo is not null;

-- Backfill: e trabalho sobre DADO DO COMPRADOR, nao DDL. Telefone que nao produz 8
-- digitos fica NULO — nunca chuta. Contato assim simplesmente nao casa por telefone, que
-- e o comportamento honesto.
--
-- 🔴 A FAIXA E A MESMA QUE O CODIGO ACEITA: 8 <= digitos <= 15. O teto e o E.164 — sem ele,
-- 300 digitos seriam "telefone valido". Se o backfill indexasse o que o codigo recusa, a
-- coluna significaria uma coisa nas linhas antigas e outra nas novas: a linha antiga viraria
-- candidata do indice e so seria descartada la na frente, na comparacao. Desperdicio
-- silencioso, e uma divergencia que ninguem consegue ver.
--
-- O `telefone_sufixo is null` no filtro mantem o backfill re-executavel: o boot reaplica
-- migration pendente, e uma segunda passada nao pode reescrever o que ja foi calculado.
update public.contatos
   set telefone_sufixo = right(regexp_replace(telefone, '\D', '', 'g'), 8)
 where telefone is not null
   and telefone_sufixo is null
   and length(regexp_replace(telefone, '\D', '', 'g')) >= 8
   and length(regexp_replace(telefone, '\D', '', 'g')) <= 15;

-- ── Tempo real ─────────────────────────────────────────────────────────────────────────
--
-- ⚠️ AQUI HAVIA O `alter publication supabase_realtime add table ...`, que inscrevia
-- `mensagens` e `conversas` no Realtime do Supabase. A publicacao `supabase_realtime` nao
-- existe num Postgres comum, e o servico que a lia tambem nao. O tempo real do inbox passou
-- a ser gatilho + `pg_notify` + SSE: ver a migration 0062 e `src/server/canais/eventos-inbox.ts`.
--
-- O bloco saiu inteiro em vez de virar no-op guardado: ele ja vinha com `exception when
-- others`, entao continuaria "passando" para sempre enquanto nao ligava nada — exatamente o
-- tipo de linha que sobrevive a uma leitura distraida parecendo que faz alguma coisa.

-- ── RPCs de escrita da conversa ────────────────────────────────────────────────────────
--
-- 🔴 O INCREMENTO E ATOMICO PORQUE ELE PRECISA SER. Ler `nao_lidas`, somar 1 no servidor e
-- gravar de volta perde contagem quando duas mensagens do mesmo cliente chegam juntas — as
-- duas leem o mesmo valor e gravam o mesmo valor. O provider ENTREGA EM PARALELO, e o
-- webhook reenvia, entao a corrida e o caso normal, nao o excepcional. O resultado do bug e
-- silencioso e ruim de explicar: a mensagem aparece na thread e o contador nao a conta.
-- `nao_lidas + 1` dentro do UPDATE resolve porque a soma acontece sob o lock da linha.
--
-- 🔴 E os timestamps usam `greatest`, nao atribuicao direta. Evento chega FORA DE ORDEM
-- (e o motivo de `origem_em` existir): sem o `greatest`, uma reentrega atrasada empurra
-- `ultima_mensagem_em` para tras e a conversa pula para o fim da lista da caixa de entrada.
create or replace function public.registrar_mensagem_na_conversa(
  p_ws uuid, p_conversa uuid, p_quando timestamptz, p_entrada boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.conversas c
     set ultima_mensagem_em = greatest(coalesce(c.ultima_mensagem_em, p_quando), p_quando),
         -- Volta para 'aberta': mensagem nova reabre conversa arquivada.
         status = 'aberta',
         ultima_msg_in_at = case when p_entrada
           then greatest(coalesce(c.ultima_msg_in_at, p_quando), p_quando)
           else c.ultima_msg_in_at end,
         nao_lidas = case when p_entrada then c.nao_lidas + 1 else c.nao_lidas end,
         atualizado_em = now()
   where c.workspace_id = p_ws and c.id = p_conversa;
end $$;

-- Contador de eventos reprovados pela segunda camada de verificacao. Mesmo motivo de ser
-- RPC: sao N containers e M requests concorrentes, e um contador lido-e-escrito perde evento
-- exatamente quando ha muitos deles — que e o unico momento em que alguem olha para ele.
create or replace function public.incrementar_rejeicoes_canal(p_ws uuid, p_canal uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.canais c
     set eventos_rejeitados = c.eventos_rejeitados + 1,
         rejeitado_em = now()
   where c.workspace_id = p_ws and c.id = p_canal;
end $$;

-- ── Reserva atomica da fila de saida ───────────────────────────────────────────────────
--
-- 🔴 `for update skip locked` e o que permite mais de um processo drenando a mesma fila sem
-- que os dois peguem a MESMA linha e o cliente receba a mensagem duas vezes. E o mesmo
-- padrao do outbox de webhook deste banco.
--
-- 🔴 ELA NAO RECEBE workspace, e a excecao e deliberada: o dreno roda no tick, que e um
-- processo do deploy e nao uma sessao — nao existe "workspace atual" ali. Filtrar por
-- workspace obrigaria a varrer workspace a workspace, e um deploy com 30 workspaces faria 30
-- consultas a cada tick para drenar uma fila que e naturalmente uma so. O isolamento nao cai
-- junto: o workspace_id de cada linha vem do banco e escopa tudo o que o codigo toca depois.
--
-- 🔴 `coalesce(m.enviando_desde, now())` — PRESERVA o carimbo de quem ja estava em voo, em
-- vez de sobrescreve-lo. Sobrescrever apaga a unica evidencia de que a linha foi reservada
-- por um processo que morreu no meio do envio, e a regra do orfao (que existe para NAO
-- reenviar uma mensagem que talvez ja tenha chegado ao cliente) fica sem como decidir: toda
-- linha pareceria recem-reservada, e toda linha seria reenviada.
--
-- ⚠️ E por isso `p_reserva` tem de ser >= a idade que o codigo trata como orfa. Menor que
-- isso, a linha volta a ser elegivel ANTES de virar orfa, e o dreno a reenvia — que e
-- exatamente o "na duvida, envia" que o marcador existe para impedir.
create or replace function public.reservar_mensagens(p_limite int, p_reserva interval)
returns setof public.mensagens language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.mensagens m
     set enviando_desde = coalesce(m.enviando_desde, now()),
         proxima_tentativa = now() + p_reserva
   where m.id in (
     select id from public.mensagens
      where status = 'pendente' and direcao = 'saida' and desistido_em is null
        and coalesce(proxima_tentativa, criado_em) <= now()
      order by criado_em
      limit p_limite
      for update skip locked
   )
  returning m.*;
end $$;