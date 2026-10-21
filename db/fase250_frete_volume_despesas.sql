-- Frete cobrado por unidade do produto e cidade/UF, independente por loja.
-- Executar inteiro. Não modifica documentos existentes nem o estoque compartilhado.
begin;
do $$begin
 if to_regprocedure('public.listar_catalogo_loja_244(uuid,text,boolean)') is null or to_regprocedure('public.orcamento_acessivel_236(uuid)') is null then raise exception 'Aplique as fases236 e246 antes da fase250';end if;
end $$;
create or replace function public.chave_cidade_250(_texto text) returns text
language sql immutable set search_path=public as $$select upper(regexp_replace(btrim(coalesce(_texto,'')),'\s+',' ','g'))$$;
revoke all on function public.chave_cidade_250(text) from public,anon;
grant execute on function public.chave_cidade_250(text) to authenticated,service_role;
create table if not exists public.loja_fretes_volume(
 centro_id uuid not null references public.centros(id) on delete cascade,
 cidade text not null check(cidade<>''),uf text not null default '',
 produto_id uuid not null references public.produtos(id) on delete cascade,
 valor_unitario numeric(14,2) not null check(valor_unitario>=0 and valor_unitario::text not in ('NaN','Infinity','-Infinity')),
 ativo boolean not null default true, updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id),
 primary key(centro_id,cidade,uf,produto_id)
);
alter table public.loja_fretes_volume enable row level security;
revoke all on public.loja_fretes_volume from public,anon,authenticated;
grant select on public.loja_fretes_volume to authenticated;
grant all on public.loja_fretes_volume to service_role;
drop policy if exists loja_frete_leitura_250 on public.loja_fretes_volume;
create policy loja_frete_leitura_250 on public.loja_fretes_volume for select to authenticated using(public.usuario_ativo() and public.usuario_pode_acessar_centro(centro_id));
alter table public.pedidos
 add column if not exists frete_volume_ativo boolean not null default false,
 add column if not exists frete_volume_valor numeric(14,2) not null default 0 check(frete_volume_valor>=0),
 add column if not exists frete_volume_detalhes jsonb not null default '[]',
 add column if not exists outras_despesas numeric(14,2) not null default 0 check(outras_despesas>=0 and outras_despesas::text not in ('NaN','Infinity','-Infinity'));
-- Documentos antigos conservam o frete atual. Novos já procuram tarifas configuradas.
alter table public.pedidos alter column frete_volume_ativo set default true;
do $$declare nova text;begin
 insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values
 ('lojas_frete_volume_configurar','Configurar frete por volume e cidade da loja','Lojas',146,'/centros') on conflict(codigo) do nothing returning codigo into nova;
 if nova is not null then insert into public.role_permissoes(role,permissao)
 select role::text,nova from public.role_menus where path='/centros' and role::text in ('admin','gestor') on conflict do nothing;end if;
 nova:=null;
 insert into public.permissoes(codigo,nome,grupo,ordem,modulo) values
 ('pedidos_encargos_editar','Definir frete por volume e outras despesas do pedido/orçamento','Pedidos',147,'/pedidos') on conflict(codigo) do nothing returning codigo into nova;
 if nova is not null then insert into public.role_permissoes(role,permissao)
 select role::text,nova from public.role_menus where path='/pedidos' on conflict do nothing;end if;
end $$;

create or replace function public.cidades_frete_volume_250(_loja uuid)
returns table(cidade text,uf text) language plpgsql stable security definer set search_path=public as $$begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('lojas_frete_volume_configurar') or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Sem acesso à configuração de frete';end if;
 return query select distinct public.chave_cidade_250(c.cidade),public.chave_cidade_250(c.uf) from public.clientes c where public.chave_cidade_250(c.cidade)<>'' order by 1,2;
end $$;
revoke all on function public.cidades_frete_volume_250(uuid) from public,anon;
grant execute on function public.cidades_frete_volume_250(uuid) to authenticated;
create or replace function public.salvar_frete_volume_250(_loja uuid,_cidade text,_uf text,_produto uuid,_valor numeric,_ativo boolean default true)
returns void language plpgsql security definer set search_path=public as $$declare cidade250 text:=public.chave_cidade_250(_cidade);uf250 text:=public.chave_cidade_250(_uf);antes jsonb;begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('lojas_frete_volume_configurar') or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Sem permissão para configurar frete nesta loja';end if;
 if _ativo is null or _valor is null or _valor<0 or _valor::text in ('NaN','Infinity','-Infinity') or _valor<>round(_valor,2) then raise exception 'Informe valor unitário válido, com até duas casas decimais';end if;
 if not exists(select 1 from public.clientes c where public.chave_cidade_250(c.cidade)=cidade250 and public.chave_cidade_250(c.uf)=uf250) then raise exception 'Selecione uma cidade/UF do cadastro de clientes';end if;
 if not exists(select 1 from public.loja_produtos l where l.centro_id=_loja and l.produto_id=_produto and (not _ativo or l.disponivel)) then raise exception 'Produto não disponível nesta loja';end if;
 select to_jsonb(f) into antes from public.loja_fretes_volume f where f.centro_id=_loja and f.cidade=cidade250 and f.uf=uf250 and f.produto_id=_produto for update;
 insert into public.loja_fretes_volume(centro_id,cidade,uf,produto_id,valor_unitario,ativo,updated_by)
 values(_loja,cidade250,uf250,_produto,_valor,_ativo,auth.uid()) on conflict(centro_id,cidade,uf,produto_id) do update set valor_unitario=excluded.valor_unitario,ativo=excluded.ativo,updated_at=clock_timestamp(),updated_by=auth.uid();
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('centros',_loja,'frete_volume_250',auth.uid(),jsonb_build_object('antes',antes,'cidade',cidade250,'uf',uf250,'produto',_produto,'valor',_valor,'ativo',_ativo));
end $$;
revoke all on function public.salvar_frete_volume_250(uuid,text,text,uuid,numeric,boolean) from public,anon;
grant execute on function public.salvar_frete_volume_250(uuid,text,text,uuid,numeric,boolean) to authenticated;

-- Uso interno: fotografia das tarifas em cada recálculo do documento em digitação.
create or replace function public.calcular_frete_volume_250(_pedido uuid) returns void
language plpgsql security definer set search_path=public as $$declare ped250 public.pedidos;total250 numeric:=0;detalhes250 jsonb:='[]';begin
 select * into ped250 from public.pedidos where id=_pedido for update;
 if ped250.id is null or ped250.status not in ('rascunho','digitacao') then return;end if;
 if ped250.frete_volume_ativo then
  select coalesce(sum(round(i.quantidade*f.valor_unitario,2)),0),coalesce(jsonb_agg(jsonb_build_object(
   'produto_id',i.produto_id,'codigo',pr.codigo,'produto',pr.descricao,'unidade',pr.unidade,'quantidade',i.quantidade,
   'cidade',f.cidade,'uf',f.uf,'valor_unitario',f.valor_unitario,'total',round(i.quantidade*f.valor_unitario,2)) order by i.id),'[]'::jsonb)
  into total250,detalhes250 from public.pedido_itens i join public.produtos pr on pr.id=i.produto_id
  join public.clientes c on c.id=ped250.cliente_id
  join public.loja_fretes_volume f on f.centro_id=ped250.centro_id and f.produto_id=i.produto_id and f.ativo
   and f.cidade=public.chave_cidade_250(c.cidade) and f.uf=public.chave_cidade_250(c.uf)
  where i.pedido_id=ped250.id;
 end if;
 update public.pedidos set frete_volume_valor=total250,frete_volume_detalhes=detalhes250 where id=ped250.id
  and (frete_volume_valor is distinct from total250 or frete_volume_detalhes is distinct from detalhes250);
end $$;
revoke all on function public.calcular_frete_volume_250(uuid) from public,anon,authenticated;
-- Preserva as guardas e a comissão existentes, alterando apenas o total dos encargos.
do $$declare d text;alvo text:='base + coalesce(frete_valor,0) + acr - dsc';begin
 select pg_get_functiondef('public.recalcular_pedido(uuid)'::regprocedure) into d;
 if position('calcular_frete_volume_250' in d)=0 then
  if position(alvo in d)=0 or position('select * into ped from public.pedidos where id = _pedido_id;' in d)=0 then raise exception 'Motor de total incompatível com a fase250';end if;
  d:=replace(d,'select * into ped from public.pedidos where id = _pedido_id;','perform public.calcular_frete_volume_250(_pedido_id); select * into ped from public.pedidos where id = _pedido_id;');
  d:=replace(d,alvo,alvo||' + coalesce(frete_volume_valor,0) + coalesce(outras_despesas,0)');
  execute d;
 end if;
end $$;
create or replace function public.recalcular_encargos_250() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.status in ('rascunho','digitacao') then perform public.recalcular_pedido(new.id);end if;return null;
end $$;
revoke all on function public.recalcular_encargos_250() from public,anon,authenticated;
drop trigger if exists recalcular_encargos_250 on public.pedidos;
create trigger recalcular_encargos_250 after update of frete_volume_ativo,outras_despesas,cliente_id,centro_id on public.pedidos for each row execute function public.recalcular_encargos_250();
create or replace function public.definir_encargos_pedido_250(_pedido uuid,_usar_volume boolean,_outras_despesas numeric)
returns void language plpgsql security definer set search_path=public as $$declare ped250 public.pedidos;begin
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) or not public.pode_rotina('pedidos_encargos_editar') then raise exception 'Sem permissão para definir os encargos';end if;
 select * into ped250 from public.pedidos where id=_pedido for update;
 if ped250.id is null or not public.usuario_pode_acessar_centro(ped250.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',ped250.id)) then raise exception 'Pedido sem acesso';end if;
 if ped250.status not in ('rascunho','digitacao') then raise exception 'Encargos só podem ser alterados em digitação';end if;
 if ped250.tipo_documento='orcamento' and not public.orcamento_acessivel_236(ped250.id) then raise exception 'Sem acesso ao orçamento';end if;
 if _usar_volume is null or _outras_despesas is null or _outras_despesas<0 or _outras_despesas::text in ('NaN','Infinity','-Infinity') or _outras_despesas<>round(_outras_despesas,2) then raise exception 'Informe outras despesas não negativas com até duas casas decimais';end if;
 update public.pedidos set frete_volume_ativo=_usar_volume,outras_despesas=_outras_despesas where id=ped250.id;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('pedidos',ped250.id,'encargos_250',auth.uid(),jsonb_build_object('frete_volume_ativo',_usar_volume,'outras_despesas',_outras_despesas));
end $$;
revoke all on function public.definir_encargos_pedido_250(uuid,boolean,numeric) from public,anon;
grant execute on function public.definir_encargos_pedido_250(uuid,boolean,numeric) to authenticated;
-- Cobranças de entrega/despesas não alteram o preço devolvido dos produtos.
do $$declare d text;begin
 if to_regprocedure('public.devolucao_itens_calc()') is not null then
  select pg_get_functiondef('public.devolucao_itens_calc()'::regprocedure) into d;
  if position('p.frete_volume_valor' in d)=0 then
   if position('p.total_liquido - p.frete_valor' in d)=0 then raise exception 'Cálculo de devolução incompatível com a fase250';end if;
   d:=replace(d,'p.total_liquido - p.frete_valor','p.total_liquido - p.frete_valor - p.frete_volume_valor - p.outras_despesas');
   d:=replace(d,'group by p.total_liquido, p.frete_valor, p.total_itens','group by p.total_liquido, p.frete_valor, p.frete_volume_valor, p.outras_despesas, p.total_itens');
   execute d;
  end if;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
