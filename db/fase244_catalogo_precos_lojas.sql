-- Lojas, parte3A: catálogo, preço-base e teto de desconto por produto.
-- Execute o arquivo inteiro depois da fase243. Estoque físico continua único.
begin;
do $$begin
 if to_regprocedure('public.salvar_parametros_loja_243(uuid,jsonb)') is null then raise exception 'Aplique a fase243 antes da fase244';end if;
end $$;
create table if not exists public.loja_produtos(
 centro_id uuid not null references public.centros(id) on delete cascade,
 produto_id uuid not null references public.produtos(id) on delete cascade,
 disponivel boolean not null default true,
 preco_venda numeric(14,4) not null check(preco_venda>=0 and preco_venda::text not in ('NaN','Infinity','-Infinity')),
 desconto_maximo numeric(5,2) check(desconto_maximo between 0 and 100 and desconto_maximo::text<>'NaN'),
 updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id) on delete set null,
 primary key(centro_id,produto_id)
);
alter table public.loja_produtos enable row level security;
revoke all on public.loja_produtos from public,anon,authenticated;
grant select on public.loja_produtos to authenticated;
grant all on public.loja_produtos to service_role;
drop policy if exists loja_produtos_leitura_244 on public.loja_produtos;
create policy loja_produtos_leitura_244 on public.loja_produtos for select to authenticated using(public.usuario_ativo() and public.usuario_pode_acessar_centro(centro_id));
-- Retrato inicial independente. Não altera preço de itens ou pedidos existentes.
insert into public.loja_produtos(centro_id,produto_id,preco_venda)
 select c.id,p.id,coalesce(p.preco_venda,0) from public.centros c cross join public.produtos p on conflict do nothing;
create or replace function public.iniciar_catalogo_loja_244() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if tg_table_name='centros' then
  insert into public.loja_produtos(centro_id,produto_id,preco_venda) select new.id,id,coalesce(preco_venda,0) from public.produtos on conflict do nothing;
 else
  insert into public.loja_produtos(centro_id,produto_id,preco_venda) select id,new.id,coalesce(new.preco_venda,0) from public.centros on conflict do nothing;
 end if;return new;
end $$;
revoke all on function public.iniciar_catalogo_loja_244() from public,anon,authenticated;
drop trigger if exists iniciar_catalogo_loja_244 on public.centros;
create trigger iniciar_catalogo_loja_244 after insert on public.centros for each row execute function public.iniciar_catalogo_loja_244();
drop trigger if exists iniciar_catalogo_produto_244 on public.produtos;
create trigger iniciar_catalogo_produto_244 after insert on public.produtos for each row execute function public.iniciar_catalogo_loja_244();
insert into public.permissoes(codigo,nome,grupo,ordem,modulo)
 values('lojas_catalogo_configurar','Configurar produtos, preços e descontos da loja','Lojas',144,'/centros') on conflict(codigo) do nothing;

create or replace function public.listar_catalogo_loja_244(_loja uuid,_busca text default '',_somente_disponiveis boolean default true)
returns table(id uuid,codigo text,descricao text,preco_venda numeric,custo_medio numeric,estoque_atual numeric,peso_kg numeric,disponivel boolean,desconto_maximo numeric)
language plpgsql stable security definer set search_path=public as $$begin
 if not public.usuario_ativo() or _loja is null or not public.usuario_pode_acessar_centro(_loja) then raise exception 'Loja sem acesso';end if;
 return query select p.id,p.codigo::text,p.descricao::text,l.preco_venda,p.custo_medio,p.estoque_atual,p.peso_kg,l.disponivel,l.desconto_maximo
 from public.loja_produtos l join public.produtos p on p.id=l.produto_id
 where l.centro_id=_loja and (not coalesce(_somente_disponiveis,true) or l.disponivel)
 and (coalesce(btrim(_busca),'')='' or p.descricao ilike '%'||_busca||'%' or p.codigo::text ilike '%'||_busca||'%')
 order by p.descricao,p.id;
end $$;
revoke all on function public.listar_catalogo_loja_244(uuid,text,boolean) from public,anon;
grant execute on function public.listar_catalogo_loja_244(uuid,text,boolean) to authenticated;
create or replace function public.salvar_produto_loja_244(_loja uuid,_produto uuid,_disponivel boolean,_preco numeric,_desconto_maximo numeric default null) returns void
language plpgsql security definer set search_path=public as $$declare antes jsonb;begin
 if not public.usuario_ativo() or not public.can_manage(auth.uid()) or not public.pode_rotina('lojas_catalogo_configurar') or not public.usuario_pode_acessar_centro(_loja) or not exists(select 1 from public.centros where id=_loja and ativo) then raise exception 'Sem permissão para configurar o catálogo desta loja';end if;
 if _disponivel is null or _preco is null or _preco<0 or _preco::text in ('NaN','Infinity','-Infinity') or _preco<>round(_preco,4) or (_desconto_maximo is not null and (_desconto_maximo<0 or _desconto_maximo>100 or _desconto_maximo::text in ('NaN','Infinity','-Infinity') or _desconto_maximo<>round(_desconto_maximo,2))) then raise exception 'Preço ou desconto inválido';end if;
 select to_jsonb(l) into antes from public.loja_produtos l where centro_id=_loja and produto_id=_produto for update;
 if antes is null then raise exception 'Produto não encontrado no catálogo da loja';end if;
 update public.loja_produtos set disponivel=_disponivel,preco_venda=_preco,desconto_maximo=_desconto_maximo,updated_at=clock_timestamp(),updated_by=auth.uid() where centro_id=_loja and produto_id=_produto;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe) values('centros',_loja,'configurar_produto_loja_244',auth.uid(),jsonb_build_object('produto_id',_produto,'antes',antes,'disponivel',_disponivel,'preco',_preco,'desconto_maximo',_desconto_maximo));
end $$;
revoke all on function public.salvar_produto_loja_244(uuid,uuid,boolean,numeric,numeric) from public,anon;
grant execute on function public.salvar_produto_loja_244(uuid,uuid,boolean,numeric,numeric) to authenticated;

-- O navegador envia o pedido, nunca escolhe outra loja/cliente para obter preço.
create or replace function public.preco_item_pedido_244(_pedido uuid,_produto uuid)
returns table(preco numeric,preco_normal numeric,tabela_nome text,vigencia_inicio date,vigencia_fim date,promocao boolean)
language plpgsql stable security definer set search_path=public as $$declare p public.pedidos;l public.loja_produtos;i record;begin
 select * into p from public.pedidos where id=_pedido;
 if not public.usuario_ativo() or p.id is null or not public.usuario_pode_acessar_centro(p.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p.id)) then raise exception 'Pedido sem acesso';end if;
 select * into l from public.loja_produtos where centro_id=p.centro_id and produto_id=_produto;
 if l.produto_id is null or not l.disponivel then raise exception 'Produto indisponível nesta loja';end if;
 -- Campanhas continuam compartilhadas nesta entrega; sua separação virá na fase seguinte.
 select * into i from public.preco_produto_info(_produto,p.cliente_id);
 return query select case when coalesce(i.promocao,false) then i.preco else l.preco_venda end,l.preco_venda,i.tabela_nome,i.vigencia_inicio,i.vigencia_fim,coalesce(i.promocao,false);
end $$;
revoke all on function public.preco_item_pedido_244(uuid,uuid) from public,anon;
grant execute on function public.preco_item_pedido_244(uuid,uuid) to authenticated;

-- Impede inserir produto de outra loja inclusive por chamada direta à RPC legada.
create or replace function public.validar_item_catalogo_244() returns trigger
language plpgsql security definer set search_path=public as $$declare loja uuid;ok boolean;begin
 select centro_id into loja from public.pedidos where id=new.pedido_id;
 select disponivel into ok from public.loja_produtos where centro_id=loja and produto_id=new.produto_id for share;
 if ok is distinct from true then raise exception 'Produto indisponível na loja deste pedido';end if;
 return new;
end $$;
revoke all on function public.validar_item_catalogo_244() from public,anon,authenticated;
drop trigger if exists validar_item_catalogo_244 on public.pedido_itens;
create trigger validar_item_catalogo_244 before insert or update of pedido_id,produto_id,quantidade,preco_unitario,desconto_percentual on public.pedido_itens for each row execute function public.validar_item_catalogo_244();
-- Documento já confirmado conserva o histórico. Em digitação, troca de loja e
-- transições de aprovação/confirmação verificam novamente a disponibilidade.
create or replace function public.validar_pedido_catalogo_244() returns trigger
language plpgsql security definer set search_path=public as $$declare it record;ok boolean;begin
 if (new.centro_id is distinct from old.centro_id or new.status in ('aguardando_aprovacao','aprovado','confirmado')) and old.status in ('rascunho','digitacao','aguardando_aprovacao','aprovado') then
  for it in select produto_id from public.pedido_itens where pedido_id=new.id order by produto_id loop
   select disponivel into ok from public.loja_produtos where centro_id=new.centro_id and produto_id=it.produto_id for share;
   if ok is distinct from true then raise exception 'Pedido contém produto indisponível na loja. Revise os itens antes de continuar';end if;
  end loop;
 end if;return new;
end $$;
revoke all on function public.validar_pedido_catalogo_244() from public,anon,authenticated;
drop trigger if exists validar_pedido_catalogo_244 on public.pedidos;
create trigger validar_pedido_catalogo_244 before update of centro_id,status on public.pedidos for each row execute function public.validar_pedido_catalogo_244();

-- Conserva o validador atual (crédito, carteira, margem e estoque) e acrescenta
-- o teto por produto. Aprovação excepcional mantém a política existente.
do $$declare d text;begin
 select pg_get_functiondef('public.validar_pedido(uuid)'::regprocedure) into d;
 if position('-- catalogo_loja_244' in d)=0 then
  if position('return res;' in lower(d))=0 then raise exception 'Validador comercial incompatível com a fase244';end if;
  d:=regexp_replace(d,'return res;(\s*end\s*(?:;\s*)?\$[a-zA-Z0-9_]*\$)', $patch$
  -- catalogo_loja_244
  if exists(select 1 from public.pedido_itens i join public.pedidos p on p.id=i.pedido_id left join public.loja_produtos l on l.centro_id=p.centro_id and l.produto_id=i.produto_id where p.id=_pedido_id and l.disponivel is distinct from true) then
   res:=res||jsonb_build_object('nivel','bloqueio','mensagem','Pedido contém produto indisponível nesta loja');
  end if;
  if exists(select 1 from public.pedido_itens i join public.pedidos p on p.id=i.pedido_id join public.loja_produtos l on l.centro_id=p.centro_id and l.produto_id=i.produto_id where p.id=_pedido_id and l.desconto_maximo is not null and coalesce(i.desconto_percentual,0)>l.desconto_maximo) then
   res:=res||jsonb_build_object('nivel','bloqueio','mensagem','Desconto de produto acima do máximo configurado para esta loja');
  end if;
  return res;\1$patch$,'i');
  if position('-- catalogo_loja_244' in d)=0 then raise exception 'Não foi possível complementar o validador comercial';end if;execute d;
 end if;
end $$;
-- Mantém a trava de preço dos representantes, usando a tabela efetiva da loja.
do $$declare d text;r regprocedure;begin
 select pg_get_functiondef('public.trg_item_preco_permitido()'::regprocedure) into d;
 if position('preco_item_pedido_244' in d)=0 then
  if position('from public.produtos where id = new.produto_id' in d)=0 then raise exception 'Trava de preço incompatível com a fase244';end if;
  d:=replace(d,'select coalesce(nullif(preco_venda, 0), 0) into v_preco'||chr(10)||'  from public.produtos where id = new.produto_id;',
   'select preco into v_preco from public.preco_item_pedido_244(new.pedido_id,new.produto_id);');
  if position('preco_item_pedido_244' in d)=0 then raise exception 'Não foi possível ajustar a trava de preço';end if;execute d;
 end if;
 -- Os preços de produtos e itens já suportam quatro casas. Evita que atualizar
 -- quantidade arredonde o preço e seja interpretado como alteração indevida.
 foreach r in array array['public.adicionar_item_pedido(uuid,uuid,numeric,numeric,numeric)'::regprocedure,'public.atualizar_item_pedido(uuid,numeric,numeric,numeric)'::regprocedure] loop
  select pg_get_functiondef(r) into d;
  if position('round(_preco_unitario,2)' in d)>0 then
   d:=replace(d,'round(_preco_unitario,2)','round(_preco_unitario,4)');execute d;
  elsif position('round(_preco_unitario,4)' in d)=0 then raise exception 'Precisão do preço incompatível: %',r;end if;
 end loop;
 if to_regprocedure('public.lead_criar_pedido(uuid,text,uuid,uuid)') is not null then
  select pg_get_functiondef('public.lead_criar_pedido(uuid,text,uuid,uuid)'::regprocedure) into d;
  if position('public.preco_produto(item.produto_id,c.id)' in d)>0 then
   d:=replace(d,'public.preco_produto(item.produto_id,c.id)','(select preco from public.preco_item_pedido_244(ped.id,item.produto_id))');execute d;
  elsif position('preco_item_pedido_244' in d)=0 then raise exception 'Pedido da agenda incompatível com a fase244';end if;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
