-- Frete automático conforme itens, com dispensa explícita preservada.
begin;
do $$begin
 if to_regprocedure('public.definir_encargos_pedido_250(uuid,boolean,numeric)') is null then raise exception 'Aplique a fase250 antes da fase253';end if;
end $$;
-- Documentos anteriores são avaliados somente ao editar/abrir com usuário autorizado.
-- Evita atualizar propostas protegidas durante a execução no SQL Editor.
alter table public.pedidos add column if not exists frete_volume_opcao text not null default 'legado' check(frete_volume_opcao in ('legado','automatico','cobrar','dispensar'));
alter table public.pedidos alter column frete_volume_opcao set default 'automatico';
alter table public.pedidos alter column frete_volume_ativo set default false;
create or replace function public.calcular_frete_volume_250(_pedido uuid) returns void
language plpgsql security definer set search_path=public as $$declare ped250 public.pedidos;total250 numeric:=0;detalhes250 jsonb:='[]';usar253 boolean;opcao253 text;begin
 select * into ped250 from public.pedidos where id=_pedido for update;
 if ped250.id is null or ped250.status not in ('rascunho','digitacao') then return;end if;
 opcao253:=ped250.frete_volume_opcao;
 if opcao253='legado' then
  opcao253:=case when not ped250.frete_volume_ativo and
   (select a.detalhe->>'frete_volume_ativo' from public.auditoria a where a.tabela='pedidos' and a.registro_id=ped250.id and a.acao='encargos_250' order by a.created_at desc,a.id desc limit 1)='false'
   then 'dispensar' else 'automatico' end;
 end if;
 usar253:=case opcao253
  when 'dispensar' then false when 'cobrar' then true else exists(
   select 1 from public.pedido_itens i join public.loja_fretes_volume f on f.produto_id=i.produto_id and f.centro_id=ped250.centro_id and f.ativo where i.pedido_id=ped250.id
  ) end;
 if usar253 then
  select coalesce(sum(round(i.quantidade*f.valor_unitario,2)),0),coalesce(jsonb_agg(jsonb_build_object(
   'produto_id',i.produto_id,'codigo',pr.codigo,'produto',pr.descricao,'unidade',pr.unidade,'quantidade',i.quantidade,
   'cidade',f.cidade,'uf',f.uf,'valor_unitario',f.valor_unitario,'total',round(i.quantidade*f.valor_unitario,2)) order by i.id),'[]'::jsonb)
  into total250,detalhes250 from public.pedido_itens i join public.produtos pr on pr.id=i.produto_id
  join public.clientes c on c.id=ped250.cliente_id
  join public.loja_fretes_volume f on f.centro_id=ped250.centro_id and f.produto_id=i.produto_id and f.ativo
   and f.cidade=public.chave_cidade_250(c.cidade) and f.uf=public.chave_cidade_250(c.uf)
  where i.pedido_id=ped250.id;
 end if;
 update public.pedidos set frete_volume_opcao=opcao253,frete_volume_ativo=usar253,frete_volume_valor=total250,frete_volume_detalhes=detalhes250 where id=ped250.id
  and (frete_volume_opcao is distinct from opcao253 or frete_volume_ativo is distinct from usar253 or frete_volume_valor is distinct from total250 or frete_volume_detalhes is distinct from detalhes250);
end $$;
revoke all on function public.calcular_frete_volume_250(uuid) from public,anon,authenticated;

-- O cálculo interno altera o estado exibido sem chamar a si próprio novamente.
drop trigger if exists recalcular_encargos_250 on public.pedidos;
create trigger recalcular_encargos_250 after update of outras_despesas,cliente_id,centro_id on public.pedidos for each row execute function public.recalcular_encargos_250();
do $$declare d text;alvo text:='set frete_volume_ativo=_usar_volume,outras_despesas=_outras_despesas';begin
 select pg_get_functiondef('public.definir_encargos_pedido_250(uuid,boolean,numeric)'::regprocedure) into d;
 if position('frete_volume_opcao' in d)=0 then
  if position(alvo in d)=0 then raise exception 'Rotina de encargos incompatível com a fase253';end if;
  execute replace(d,alvo,'set frete_volume_opcao=case when _usar_volume is distinct from ped250.frete_volume_ativo then case when _usar_volume then ''cobrar'' else ''dispensar'' end else ped250.frete_volume_opcao end,frete_volume_ativo=_usar_volume,outras_despesas=_outras_despesas');
 end if;
end $$;
create or replace function public.atualizar_frete_automatico_253(_pedido uuid) returns void
language plpgsql security definer set search_path=public as $$declare p253 public.pedidos;begin
 if not public.usuario_ativo() or not public.can_operate(auth.uid()) or not public.pode_rotina('pedidos_encargos_editar') then raise exception 'Sem permissão para conferir frete';end if;
 select * into p253 from public.pedidos where id=_pedido for update;
 if p253.id is null or not public.usuario_pode_acessar_centro(p253.centro_id) or (public.escopo_representante() and not public.documento_na_minha_carteira('pedidos',p253.id)) then raise exception 'Pedido sem acesso';end if;
 if p253.status not in ('rascunho','digitacao') or p253.frete_volume_opcao not in ('automatico','legado') then return;end if;
 if p253.tipo_documento='orcamento' and not public.orcamento_acessivel_236(p253.id) then raise exception 'Sem acesso ao orçamento';end if;
 perform public.recalcular_pedido(p253.id);
end $$;
revoke all on function public.atualizar_frete_automatico_253(uuid) from public,anon;
grant execute on function public.atualizar_frete_automatico_253(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
