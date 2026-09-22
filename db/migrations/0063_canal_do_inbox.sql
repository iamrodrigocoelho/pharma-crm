-- 0063_canal_do_inbox.sql — renomeia o canal do NOTIFY de `awave_inbox` para
-- `pharma_inbox`, acompanhando a troca de marca do produto.
--
-- 🔴 OS DOIS LADOS TÊM DE MUDAR JUNTOS. O nome do canal é um contrato entre esta
-- função e o `LISTEN` de `src/server/canais/eventos-inbox.ts`. Se um for atualizado
-- sem o outro, nada falha, nada aparece no log e nenhum teste quebra — o inbox
-- simplesmente para de atualizar sozinho, e a queda só aparece como "o CRM está
-- lento para mostrar mensagem nova". É o tipo de divergência que não dá sinal.
--
-- Durante um deploy, containers da versão antiga e da nova convivem por alguns
-- segundos: o antigo escuta `awave_inbox`, o novo publica em `pharma_inbox`. Quem
-- estiver com a inbox aberta nessa janela deixa de receber o cutucão e volta a
-- receber assim que o container novo assume. Nenhuma mensagem se perde: o push é
-- otimização de latência, e a reconciliação por leitura continua sendo a fonte da
-- verdade (ver o comentário da 0062).

create or replace function public.notificar_inbox()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  v_ws := coalesce(new.workspace_id, old.workspace_id);
  if v_ws is not null then
    perform pg_notify('pharma_inbox', v_ws::text);
  end if;
  return null;
end $$;
