-- Conexão protegida por loja. Não transmite documentos fiscais.
begin;
do $$begin
 if to_regclass('public.loja_fiscal_256') is null then raise exception 'Aplique a fase256 antes da fase257';end if;
end $$;
create table if not exists public.faznotas_credenciais_257(
 centro_id uuid primary key references public.centros(id),
 cnpj text not null check(cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
 token text not null check(length(token) between 8 and 2048 and token !~ '[[:space:]]'),
 updated_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id)
);
alter table public.faznotas_credenciais_257 enable row level security;
revoke all on public.faznotas_credenciais_257 from public,anon,authenticated;
grant select on public.faznotas_credenciais_257 to service_role;
create or replace function public.estado_conexao_faznotas_257(_loja uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare cred public.faznotas_credenciais_257;cnpj257 text;
begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('configuracao_rotinas_editar') or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Sem acesso à conexão fiscal desta loja';end if;
 select upper(regexp_replace(coalesce(c.cnpj,''),'[^a-zA-Z0-9]','','g')) into cnpj257 from public.centros c where c.id=_loja and c.ativo;
 if cnpj257 is null then raise exception 'Loja inválida ou inativa';end if;
 select * into cred from public.faznotas_credenciais_257 where centro_id=_loja;
 return jsonb_build_object('cnpj_loja',cnpj257,'cnpj_configurado',cred.cnpj,'token_configurado',cred.centro_id is not null,'cnpj_confere',cred.cnpj=cnpj257,'updated_at',cred.updated_at);
end $$;
revoke all on function public.estado_conexao_faznotas_257(uuid) from public,anon;
grant execute on function public.estado_conexao_faznotas_257(uuid) to authenticated;
create or replace function public.salvar_conexao_faznotas_257(_loja uuid,_cnpj text,_token text)
returns void language plpgsql security definer set search_path=public as $$
declare estado257 jsonb;atual257 public.faznotas_credenciais_257;cnpj257 text;novo257 text;
begin
 -- A mesma trava da loja impede uma alteração de CNPJ simultânea ao vínculo.
 perform 1 from public.centros c where c.id=_loja for update;
 estado257:=public.estado_conexao_faznotas_257(_loja);
 if not public.has_role(auth.uid(),'admin') then raise exception 'Somente administrador configura o token fiscal';end if;
 cnpj257:=upper(regexp_replace(coalesce(_cnpj,''),'[^a-zA-Z0-9]','','g'));
 if cnpj257 !~ '^[A-Z0-9]{12}[0-9]{2}$' or cnpj257 is distinct from estado257->>'cnpj_loja' then raise exception 'O CNPJ informado deve corresponder ao cadastro da loja';end if;
 select * into atual257 from public.faznotas_credenciais_257 where centro_id=_loja for update;
 novo257:=coalesce(nullif(btrim(_token),''),case when atual257.cnpj=cnpj257 then atual257.token end);
 if novo257 is null or length(novo257) not between 8 and 2048 or novo257 ~ '[[:space:]]' then raise exception 'Informe somente o token FAZNOTAS, sem o prefixo Token e sem espaços';end if;
 insert into public.faznotas_credenciais_257(centro_id,cnpj,token,updated_by) values(_loja,cnpj257,novo257,auth.uid())
 on conflict(centro_id) do update set cnpj=excluded.cnpj,token=excluded.token,updated_at=now(),updated_by=auth.uid();
 insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
 values('centros',_loja,'faznotas_conexao_configurada',jsonb_build_object('cnpj',cnpj257),auth.uid());
end $$;
revoke all on function public.salvar_conexao_faznotas_257(uuid,text,text) from public,anon;
grant execute on function public.salvar_conexao_faznotas_257(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
