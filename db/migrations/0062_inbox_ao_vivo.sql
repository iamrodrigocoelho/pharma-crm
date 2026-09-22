-- 0062_inbox_ao_vivo.sql — o inbox ao vivo sem o Realtime do Supabase.
--
-- O Realtime lia o WAL por fora do banco e empurrava as mudanças de `mensagens` e
-- `conversas` para o navegador. No lugar dele: `pg_notify` num gatilho, uma conexão
-- do servidor em `LISTEN`, e SSE até a aba. Ver `src/server/canais/eventos-inbox.ts`.
--
-- Por que o payload é SÓ o workspace_id, e não a linha: o `NOTIFY` tem teto de ~8 KB
-- por mensagem e o cliente já faz reconciliação por leitura (`reconciliar()` no hook)
-- — mandar a linha inteira seria carga maior para um cliente que vai reler de todo
-- jeito. O evento aqui é um cutucão, não um dado.
--
-- 🔴 `pg_notify` SÓ ENTREGA EM CONEXÃO VIVA. Quem estiver desconectado no instante do
-- commit não recebe nada — não há fila nem replay. É por isso que o supervisor do
-- inbox continua fazendo reconciliação periódica e ao voltar o foco: o push é
-- otimização de latência, e a leitura é que é a fonte da verdade.

create or replace function public.notificar_inbox()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  -- `old` em delete, `new` nos demais. O gatilho é AFTER, então o valor já está firme.
  v_ws := coalesce(new.workspace_id, old.workspace_id);
  if v_ws is not null then
    perform pg_notify('awave_inbox', v_ws::text);
  end if;
  return null;
end $$;

-- Só INSERT e UPDATE: a inbox não mostra remoção de mensagem, e o expurgo apaga em
-- lote (um NOTIFY por linha apagada seria ruído proporcional ao tamanho do lote).
drop trigger if exists mensagens_notifica_inbox on public.mensagens;
create trigger mensagens_notifica_inbox
  after insert or update on public.mensagens
  for each row execute function public.notificar_inbox();

drop trigger if exists conversas_notifica_inbox on public.conversas;
create trigger conversas_notifica_inbox
  after insert or update on public.conversas
  for each row execute function public.notificar_inbox();
