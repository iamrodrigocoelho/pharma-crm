

-- == RPC: criar workspace + provisionar funil padrao =======================
create or replace function public.criar_workspace(nome text, p_dono uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_pipe uuid;
begin
  if p_dono is null then raise exception 'dono ausente'; end if;
  insert into public.workspaces (nome, dono_id) values (nome, p_dono) returning id into v_ws;
  insert into public.membros (workspace_id, user_id, papel) values (v_ws, p_dono, 'owner');
  insert into public.pipelines (workspace_id, nome, ordem, is_padrao)
    values (v_ws, 'Funil de vendas', 0, true) returning id into v_pipe;
  insert into public.etapas (workspace_id, pipeline_id, nome, ordem, cor)
  select v_ws, v_pipe, e.nome, e.ordem, e.cor from (values
    ('Novo lead', 0, '#94a3b8'), ('Contato feito', 1, '#60a5fa'),
    ('Proposta', 2, '#a78bfa'), ('Negociacao', 3, '#fbbf24'),
    ('Fechamento', 4, '#34d399')
  ) as e(nome, ordem, cor);
  return v_ws;
end $$;

-- == RPC: aceitar convite (consome atomico; tolera ja-membro) ==============
-- ⚠️ MUDOU COM A SAÍDA DO SUPABASE. Quem aceita vinha de `auth.uid()`; agora chega como
-- argumento, porque não há mais sessão do GoTrue visível de dentro do banco. Quem chama é o
-- servidor, depois de resolver a sessão pelo cookie — o argumento não vem do navegador.
-- O `update` continua sendo a trava de concorrência: só UMA chamada consegue marcar o
-- convite como aceito, e as demais caem no 'convite invalido'.
create or replace function public.aceitar_convite(p_token text, p_usuario uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_papel text;
begin
  if p_usuario is null then raise exception 'sem sessao'; end if;
  update public.convites set aceito_em = now(), aceito_por = p_usuario
    where token = p_token and aceito_em is null and expira_em > now()
    returning workspace_id, papel into v_ws, v_papel;
  if v_ws is null then raise exception 'convite invalido'; end if;
  insert into public.membros (workspace_id, user_id, papel) values (v_ws, p_usuario, v_papel)
    on conflict (workspace_id, user_id) do nothing;
  return v_ws;
end $$;