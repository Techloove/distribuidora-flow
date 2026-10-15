-- Fase234: Expedição passa a integrar Entregas, sem apagar romaneios/histórico.
-- Aplicar após fase233. Não altera estoque, títulos, notas nem status de pedidos.
begin;
do $$ begin
 if to_regprocedure('public.despachar_carga_233(uuid,date)') is null then
  raise exception 'Aplique a fase233 antes da fase234';
 end if;
 -- Migração única de menus: reaplicar não restaura acessos posteriormente revogados.
 if not exists(select 1 from public.auditoria where tabela='fase234' and acao='instalada') then
  insert into public.role_menus(role,path)
   select distinct role,'/entregas' from public.role_menus where path='/expedicao' on conflict do nothing;
  insert into public.role_permissoes(role,permissao)
   select distinct m.role::text,'entregas_operar' from public.role_menus m
    join public.role_permissoes rp on rp.role=m.role::text and rp.permissao='entrega_registrar'
    where m.path='/expedicao' on conflict do nothing;
  delete from public.role_menus where path='/expedicao';
  insert into public.auditoria(tabela,acao,detalhe) values('fase234','instalada','{"menu":"/entregas"}');
 end if;
 update public.permissoes set modulo='/entregas',grupo='Entregas'
  where codigo in ('entrega_registrar','entrega_parcial_operar');
 update public.permissoes set nome='Registrar ocorrências e consultar comprovantes' where codigo='entrega_registrar';
end $$;

-- Conserva os motores existentes e suas assinaturas/ACLs. Revalida acesso após
-- os locks e protege a carteira do cliente durante a alteração operacional.
do $$ declare r record; definicao text; guarda text; identificador text; begin
 for r in select * from (values
  ('registrar_entrega(uuid,text,text,text,text)','_expedicao_id'),
  ('registrar_parcial_214(uuid,jsonb,text,text,text,uuid)','_expedicao'),
  ('atualizar_dados_expedicao(uuid,uuid,text,text,date,numeric,numeric,uuid,text,text)','_id')
 ) x(assinatura,parametro) loop
  if to_regprocedure('public.'||r.assinatura) is null then raise exception 'Rotina obrigatória ausente: %',r.assinatura; end if;
  select pg_get_functiondef(to_regprocedure('public.'||r.assinatura)) into definicao;
  if position('entregas_guard_234' in definicao)=0 then
   identificador:=r.parametro;
   guarda:=format($guard$
 -- entregas_guard_234
 if not public.entrega_acessivel_232(%1$s) then raise exception 'Entrega sem acesso'; end if;
 perform 1 from public.expedicoes where id=%1$s for update;
 perform 1 from public.pedidos where id=(select pedido_id from public.expedicoes where id=%1$s) for update;
 perform 1 from public.clientes where id=(select pp234.cliente_id from public.pedidos pp234 join public.expedicoes ee234 on ee234.pedido_id=pp234.id where ee234.id=%1$s) for share;
 if not public.entrega_acessivel_232(%1$s) then raise exception 'Entrega sem acesso'; end if;
 $guard$,identificador);
   if r.parametro='_expedicao_id' then
    guarda:=guarda||$guard$
 if _tipo is distinct from 'ocorrencia' then raise exception 'Formalize a entrega completa na tela Entregas'; end if;
 $guard$;
   elsif r.parametro='_id' then
    guarda:=guarda||$guard$
 if exists(select 1 from public.expedicoes where id=_id and status='cancelada') then raise exception 'Romaneio cancelado não pode ser alterado'; end if;
 $guard$;
   end if;
   definicao:=regexp_replace(definicao,'\mbegin\M',E'begin\n'||guarda,'i');
   execute definicao;
  end if;
  execute 'revoke all on function public.'||r.assinatura||' from public,anon';
 end loop;
end $$;
commit;
