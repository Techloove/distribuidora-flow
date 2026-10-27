-- Executar manualmente este SQL inteiro no Supabase antes de publicar a versão1.3.0.
-- Produtos passa a ser a fonte do preço normal. Promoções e pedidos não são alterados.
begin;
do $$begin
 if to_regprocedure('public.produto_categoria_loja_246(uuid,uuid)') is null
 or to_regprocedure('public.loja_produto_estoque_271(uuid)') is null then
   raise exception 'Aplique as fases246 e271 antes da fase275';
 end if;
end $$;
lock table public.produtos,public.loja_produtos in share row exclusive mode;

-- Retrato privado inicial, preservado quando o arquivo é executado novamente.
create table if not exists public.preco_retrato_275(
 centro_id uuid not null,produto_id uuid not null,
 preco_loja_anterior numeric(14,4),preco_produto_inicial numeric(14,4),
 configuracao_anterior jsonb not null,capturado_em timestamptz not null default now(),
 primary key(centro_id,produto_id)
);
alter table public.preco_retrato_275 enable row level security;
revoke all on public.preco_retrato_275 from public,anon,authenticated,service_role;
insert into public.preco_retrato_275(centro_id,produto_id,preco_loja_anterior,preco_produto_inicial,configuracao_anterior)
 select l.centro_id,l.produto_id,l.preco_venda,p.preco_venda,to_jsonb(l)
 from public.loja_produtos l join public.produtos p on p.id=l.produto_id
 on conflict do nothing;

-- Executa depois do markup: uma mudança de custo também pode recalcular o preço.
create or replace function public.sincronizar_preco_produto_275() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.preco_venda is distinct from old.preco_venda then
   if new.preco_venda is null or new.preco_venda<0
      or new.preco_venda::text in ('NaN','Infinity','-Infinity') then
     raise exception 'Preço de venda inválido';
   end if;
   -- O preço é único, mas a edição continua limitada à loja da categoria do produto.
   if auth.uid() is not null and exists(
     select 1 from public.centros c where c.ativo
       and public.produto_categoria_loja_246(c.id,new.id)
       and not coalesce(public.usuario_pode_acessar_centro(c.id),false)
   ) then raise exception 'Sem acesso à loja deste produto para alterar o preço';end if;
   update public.loja_produtos set preco_venda=new.preco_venda,
     updated_at=clock_timestamp(),updated_by=auth.uid()
   where produto_id=new.id and preco_venda is distinct from new.preco_venda;
 end if;
 return new;
end $$;
revoke all on function public.sincronizar_preco_produto_275() from public,anon,authenticated,service_role;
drop trigger if exists sincronizar_preco_produto_275 on public.produtos;
-- Sem lista OF: captura também o preço calculado pelo gatilho de markup/custo.
create trigger sincronizar_preco_produto_275 after update on public.produtos
for each row execute function public.sincronizar_preco_produto_275();

-- Mantém assinatura e permissões do editor existente. Sempre bloqueia o produto
-- antes das linhas do catálogo, evitando inversão de bloqueios entre as duas telas.
create or replace function public.salvar_produto_loja_244(
 _loja uuid,_produto uuid,_disponivel boolean,_preco numeric,_desconto_maximo numeric default null
) returns void language plpgsql security definer set search_path=public as $$
declare antes jsonb;preco_anterior numeric;begin
 if auth.uid() is null or not coalesce(public.usuario_ativo(),false) or not coalesce(public.can_manage(auth.uid()),false)
 or not coalesce(public.pode_rotina('lojas_catalogo_configurar'),false)
 or not coalesce(public.usuario_pode_acessar_centro(_loja),false)
 or not exists(select 1 from public.centros where id=_loja and ativo) then
   raise exception 'Sem permissão para configurar o catálogo desta loja';end if;
 if _disponivel is null or _preco is null or _preco<0
 or _preco::text in ('NaN','Infinity','-Infinity') or _preco<>round(_preco,4)
 or (_desconto_maximo is not null and (_desconto_maximo<0 or _desconto_maximo>100
 or _desconto_maximo::text in ('NaN','Infinity','-Infinity') or _desconto_maximo<>round(_desconto_maximo,2))) then
   raise exception 'Preço ou desconto inválido';end if;
 select preco_venda into preco_anterior from public.produtos where id=_produto for update;
 if not found then raise exception 'Produto não encontrado';end if;
 if not coalesce(public.produto_categoria_loja_246(_loja,_produto),false) then
   raise exception 'O produto não pertence à categoria desta loja';end if;
 select to_jsonb(l) into antes from public.loja_produtos l
   where centro_id=_loja and produto_id=_produto for update;
 if antes is null then raise exception 'Produto não encontrado no catálogo da loja';end if;
 update public.produtos set preco_venda=_preco
   where id=_produto and preco_venda is distinct from _preco;
 update public.loja_produtos set disponivel=_disponivel,preco_venda=_preco,
   desconto_maximo=_desconto_maximo,updated_at=clock_timestamp(),updated_by=auth.uid()
   where centro_id=_loja and produto_id=_produto;
 insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe)
 values('centros',_loja,'configurar_produto_loja_244',auth.uid(),
   jsonb_build_object('produto_id',_produto,'antes',antes,'disponivel',_disponivel,
     'preco',_preco,'desconto_maximo',_desconto_maximo,'preco_produto_anterior',preco_anterior,'sincronizado',true));
end $$;
revoke all on function public.salvar_produto_loja_244(uuid,uuid,boolean,numeric,numeric) from public,anon;
grant execute on function public.salvar_produto_loja_244(uuid,uuid,boolean,numeric,numeric) to authenticated;

-- Alinhamento inicial usa a referência atual do cadastro geral, sem reprecificar vendas.
insert into public.auditoria(tabela,registro_id,acao,user_id,detalhe)
 select 'centros',l.centro_id,'alinhar_preco_275',auth.uid(),
   jsonb_build_object('produto_id',l.produto_id,'preco_anterior',l.preco_venda,'preco',p.preco_venda)
 from public.loja_produtos l join public.produtos p on p.id=l.produto_id
 where l.preco_venda is distinct from p.preco_venda;
update public.loja_produtos l set preco_venda=p.preco_venda,updated_at=clock_timestamp(),updated_by=auth.uid()
 from public.produtos p where p.id=l.produto_id and l.preco_venda is distinct from p.preco_venda;
commit;
