

-- == a tabela ==============================================================
create table if not exists public.anexos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  -- Caminho DENTRO do bucket: `<workspace_id>/<negocio_id>/<uuid>.<ext>`. O prefixo de
  -- workspace não é enfeite: ele torna óbvio, na inspeção do bucket, a que tenant um objeto
  -- pertence, e é o que permitiria criar política por prefixo no futuro sem migrar arquivo.
  caminho text not null unique,
  -- O nome que a PESSOA vê e baixa, preservado como veio (só higienizado). O caminho é
  -- opaco de propósito — nome de arquivo de cliente não deve virar parte de URL.
  nome text not null,
  tamanho bigint not null,
  tipo text not null,
  criado_por uuid references public.usuarios(id) on delete set null,
  criado_em timestamptz not null default now()
);

create index if not exists anexos_negocio_idx on public.anexos (workspace_id, negocio_id, criado_em desc);