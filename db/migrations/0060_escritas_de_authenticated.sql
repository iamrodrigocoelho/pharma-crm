

-- A leitura NÃO é tocada: `workspaces_sel` e `membros_sel` (as duas da `0005`) continuam de
-- pé. Sem elas a tela do usuário logado para de enxergar o próprio espaço de trabalho.

-- ═══ PARTE 2: `criar_workspace` deixa de aceitar um dono escolhido pela sessão ═════════════
--
-- Corpo idêntico ao da `0017` (que é a versão vigente), com UMA mudança de comportamento: o
-- dono passa a sair de `v_dono`, e `v_dono` prefere `auth.uid()` ao parâmetro.
--
--   · pela SESSÃO   → `auth.uid()` é o usuário logado, e `p_dono` é ignorado. Forjar o dono
--                     deixa de ser possível, venha a chamada da tela ou do console.
--   · pelo SERVIÇO  → `auth.uid()` é nulo (medido), então `p_dono` vale. É o que os dois
--                     chamadores do produto usam, e o que o `admin()` da tela precisa.
--
-- ⚠️ MUDOU COM A SAÍDA DO SUPABASE. `v_dono` vinha de `auth.uid()` e IGNORAVA o `p_dono` de
-- quem chamava, porque o PostgREST publicava esta função numa porta HTTP alcançável por
-- qualquer sessão `authenticated`: confiar no argumento ali deixaria alguém criar workspace
-- no nome de outro. Sem PostgREST essa porta não existe — a função só é alcançável pelo
-- código do servidor, que já sabe quem é o usuário. O argumento volta a ser a fonte, e quem
-- passa `p_dono` errado é o servidor, não um cliente.
--
-- O `nome` vazio passa a ser recusado aqui também: a server action já aparava e recusava, e a
-- porta do PostgREST não. Duas portas para o mesmo insert precisam da mesma regra, senão a
-- validação é só uma sugestão da tela.
create or replace function public.criar_workspace(nome text, p_dono uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_pipe uuid; v_dono uuid; v_nome text;
begin
  v_dono := p_dono;
  if v_dono is null then raise exception 'dono ausente'; end if;
  v_nome := btrim(coalesce(nome, ''));
  if v_nome = '' then raise exception 'nome vazio'; end if;
  insert into public.workspaces (nome, dono_id) values (v_nome, v_dono) returning id into v_ws;
  insert into public.membros (workspace_id, user_id, papel) values (v_ws, v_dono, 'owner');
  insert into public.pipelines (workspace_id, nome, ordem, is_padrao)
    values (v_ws, 'Funil de vendas', 0, true) returning id into v_pipe;
  insert into public.etapas (workspace_id, pipeline_id, nome, ordem, cor)
  select v_ws, v_pipe, e.nome, e.ordem, e.cor from (values
    ('Novo lead', 0, '#94a3b8'), ('Contato feito', 1, '#60a5fa'),
    ('Proposta', 2, '#a78bfa'), ('Negociação', 3, '#fbbf24'),
    ('Fechamento', 4, '#34d399')
  ) as e(nome, ordem, cor);
  insert into public.tipos_atividade (workspace_id, slug, nome, icone, natureza, ordem, bloqueado)
  select v_ws, d.slug, d.nome, d.icone, d.natureza, d.ordem, d.bloqueado from (values
    ('ligacao','Ligação','Phone','atividade',0,false),
    ('reuniao','Reunião','Users','atividade',1,false),
    ('tarefa','Tarefa','CircleCheck','atividade',2,false),
    ('email','E-mail','Mail','atividade',3,false),
    ('prazo','Prazo','Flag','atividade',4,false),
    ('nota','Nota','StickyNote','nota',5,true),
    ('etapa_mudou','Etapa mudou','ArrowRight','sistema',6,true),
    ('resumo_ia','Resumo IA','Sparkles','sistema',7,true)
  ) as d(slug,nome,icone,natureza,ordem,bloqueado);
  return v_ws;
end $$;