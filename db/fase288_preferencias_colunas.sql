-- Preferências pessoais não concedem acesso aos dados das telas.
begin;
create table if not exists public.preferencias_colunas (
 usuario_id uuid not null references auth.users(id) on delete cascade,
 tela text not null check(length(tela) between 1 and 4000),
 ocultas jsonb not null default '[]'::jsonb check(jsonb_typeof(ocultas)='array' and jsonb_array_length(ocultas)<=200 and pg_column_size(ocultas)<=16000),
 primary key(usuario_id,tela)
);
alter table public.preferencias_colunas enable row level security;
revoke all on public.preferencias_colunas from anon,authenticated;
grant select,insert,update,delete on public.preferencias_colunas to authenticated;
grant all on public.preferencias_colunas to service_role;
drop policy if exists preferencias_pessoais on public.preferencias_colunas;
create policy preferencias_pessoais on public.preferencias_colunas for all to authenticated using(usuario_id=auth.uid() and public.usuario_ativo()) with check(usuario_id=auth.uid() and public.usuario_ativo());
notify pgrst,'reload schema';
commit;
