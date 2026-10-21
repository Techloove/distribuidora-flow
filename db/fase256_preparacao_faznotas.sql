-- Preparação cadastral NF-e55. Não emite notas nem altera documentos existentes.
begin;
do $$begin
 if to_regprocedure('public.produto_categoria_loja_246(uuid,uuid)') is null or to_regclass('public.loja_produtos') is null then raise exception 'Aplique as fases de catálogo por loja até a fase246 antes da fase256';end if;
end $$;
alter table public.produtos add column if not exists origem_fiscal text;
alter table public.produtos add column if not exists cfop_interestadual text;
alter table public.produtos add column if not exists ncm text;
alter table public.produtos add column if not exists cest text;
alter table public.produtos add column if not exists ean text;
alter table public.produtos add column if not exists cfop text;
create table if not exists public.loja_fiscal_256 (
 centro_id uuid primary key references public.centros(id),
 serie text not null check(serie ~ '^[1-9][0-9]{0,2}$'),
 uf_emitente text not null check(uf_emitente in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
 regime text not null check(regime in ('1','2','3','4')),
 cfop_interno text not null check(cfop_interno ~ '^5[0-9]{3}$'),
 cfop_interestadual text not null check(cfop_interestadual ~ '^6[0-9]{3}$'),
 revisado_contador boolean not null default false,
 updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
alter table public.loja_fiscal_256 enable row level security;
revoke all on public.loja_fiscal_256 from public,anon,authenticated;
grant select on public.loja_fiscal_256 to authenticated;
grant all on public.loja_fiscal_256 to service_role;
drop policy if exists loja_fiscal_leitura_256 on public.loja_fiscal_256;
create policy loja_fiscal_leitura_256 on public.loja_fiscal_256 for select to authenticated
using (public.usuario_ativo() and public.can_manage(auth.uid()) and public.usuario_pode_acessar_centro(centro_id));
create or replace function public.salvar_loja_fiscal_256(_loja uuid,_serie text,_uf text,_regime text,_interno text,_interestadual text,_revisado boolean)
returns void language plpgsql security definer set search_path=public as $$begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('configuracao_rotinas_editar') or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Sem permissão para configurar o fiscal da loja';end if;
 if not exists(select 1 from public.centros c where c.id=_loja and c.ativo) then raise exception 'Loja inválida ou inativa';end if;
 if _revisado is null then raise exception 'Informe a situação da revisão fiscal';end if;
 insert into public.loja_fiscal_256(centro_id,serie,uf_emitente,regime,cfop_interno,cfop_interestadual,revisado_contador,updated_by)
 values(_loja,btrim(_serie),upper(btrim(_uf)),_regime,btrim(_interno),btrim(_interestadual),_revisado,auth.uid())
 on conflict(centro_id) do update set serie=excluded.serie,uf_emitente=excluded.uf_emitente,regime=excluded.regime,
 cfop_interno=excluded.cfop_interno,cfop_interestadual=excluded.cfop_interestadual,revisado_contador=excluded.revisado_contador,updated_at=now(),updated_by=auth.uid();
end $$;
revoke all on function public.salvar_loja_fiscal_256(uuid,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.salvar_loja_fiscal_256(uuid,text,text,text,text,text,boolean) to authenticated;
create or replace function public.catalogo_fiscal_256(_loja uuid)
returns table(id uuid,codigo text,descricao text,ncm text,cest text,ean text,unidade text,origem_fiscal text,cfop text,cfop_interestadual text)
language plpgsql stable security definer set search_path=public as $$begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('configuracao_rotinas_editar') or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Sem acesso ao catálogo fiscal';end if;
 return query select p.id,p.codigo::text,p.descricao::text,p.ncm,p.cest,p.ean,p.unidade::text,p.origem_fiscal,p.cfop,p.cfop_interestadual
 from public.produtos p join public.loja_produtos l on l.produto_id=p.id and l.centro_id=_loja
 where l.disponivel and public.produto_categoria_loja_246(_loja,p.id) order by p.descricao,p.id;
end $$;
revoke all on function public.catalogo_fiscal_256(uuid) from public,anon;
grant execute on function public.catalogo_fiscal_256(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
