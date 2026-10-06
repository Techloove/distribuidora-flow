-- Fase 206: carteira obrigatória para representantes, inclusive com outros papéis.
-- Aplicar após fase205. Não altera clientes, vínculos ou permissões de menus.
begin;

create or replace function public.escopo_representante()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'representante')
     and not public.has_role(auth.uid(), 'admin');
$$;
revoke all on function public.escopo_representante() from public, anon;
grant execute on function public.escopo_representante() to authenticated, service_role;
revoke all on function public.meu_representante_id() from public, anon;
grant execute on function public.meu_representante_id() to authenticated, service_role;

-- A ausência de vínculo é um escopo vazio, nunca acesso geral.
create or replace function public.cliente_na_minha_carteira(_cliente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.usuario_ativo() and exists (
    select 1 from public.clientes c where c.id = _cliente
      and c.representante_id = public.meu_representante_id()
  );
$$;
revoke all on function public.cliente_na_minha_carteira(uuid) from public, anon;
grant execute on function public.cliente_na_minha_carteira(uuid) to authenticated, service_role;

-- RPCs SECURITY DEFINER ignoram RLS: conferência explícita antes de ler documentos.
create or replace function public.documento_na_minha_carteira(_tabela text, _id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare permitido boolean;
begin
  if not public.usuario_ativo() then return false; end if;
  if _tabela in ('clientes','pessoas') then
    execute format('select exists(select 1 from public.%I where id=$1 and representante_id=public.meu_representante_id())',_tabela) into permitido using _id;
  elsif _tabela in ('pedidos','contas_receber','boletos','creditos_clientes','devolucoes') then
    execute format('select exists(select 1 from public.%I d join public.clientes c on c.id=d.cliente_id where d.id=$1 and c.representante_id=public.meu_representante_id())',_tabela) into permitido using _id;
    if _tabela = 'pedidos' then
      permitido := permitido and exists(select 1 from public.pedidos where id=_id and representante_id=public.meu_representante_id());
    end if;
  elsif _tabela = 'pedido_itens' then
    select exists(select 1 from public.pedido_itens i join public.pedidos p on p.id=i.pedido_id
      join public.clientes c on c.id=p.cliente_id where i.id=_id
      and p.representante_id=public.meu_representante_id() and c.representante_id=public.meu_representante_id()) into permitido;
  elsif _tabela = 'cargas' then
    execute 'select exists(select 1 from public.carga_pedidos where carga_id=$1)
      and not exists(select 1 from public.carga_pedidos cp where cp.carga_id=$1
        and not public.documento_na_minha_carteira(''pedidos'',cp.pedido_id))' into permitido using _id;
  elsif _tabela = 'ondas_separacao' then
    execute 'select exists(select 1 from public.pedidos where onda_id=$1)
      and not exists(select 1 from public.pedidos p where p.onda_id=$1
        and not public.documento_na_minha_carteira(''pedidos'',p.id))' into permitido using _id;
  else
    return false;
  end if;
  return coalesce(permitido,false);
end $$;
revoke all on function public.documento_na_minha_carteira(text,uuid) from public, anon;
grant execute on function public.documento_na_minha_carteira(text,uuid) to authenticated, service_role;

-- Políticas RESTRICTIVE: concessões permissivas anteriores não ampliam a carteira.
-- Cada referência é qualificada para evitar comparação acidental dentro da subconsulta.
do $$
declare t record; col record; regra text; parte text;
begin
  for t in select c.oid, c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  loop
    regra := null;
    if t.relname in ('clientes','pessoas') then
      regra := 'representante_id = public.meu_representante_id()';
    elsif t.relname = 'representantes' then
      regra := 'id = public.meu_representante_id()';
    else
      for col in select a.attname from pg_attribute a
        where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
          and a.attname in ('cliente_id','pedido_id','representante_id','conta_receber_id')
      loop
        parte := case col.attname
          when 'cliente_id' then format('public.cliente_na_minha_carteira(%I.cliente_id)', t.relname)
          when 'representante_id' then format('%I.representante_id = public.meu_representante_id()', t.relname)
          when 'pedido_id' then format('exists (select 1 from public.pedidos carteira_p where carteira_p.id = %I.pedido_id)', t.relname)
          when 'conta_receber_id' then format('exists (select 1 from public.contas_receber carteira_cr where carteira_cr.id = %I.conta_receber_id)', t.relname)
        end;
        -- Referências opcionais não devem excluir um título manual ou boleto sem pedido.
        -- Cliente, quando presente, é sempre obrigatório; sem nenhum proprietário, nega.
        if col.attname <> 'cliente_id' and exists (
          select 1 from pg_attribute a where a.attrelid=t.oid and a.attname in ('cliente_id','representante_id') and not a.attisdropped
        ) then
          parte := format('(%I.%I is null or (%s))', t.relname, col.attname, parte);
        end if;
        -- Tabelas de preços e regras gerais são cadastros compartilhados.
        if t.relname in ('tabelas_preco','regras_comissao','comissao_faixas') then
          parte := format('(%I.%I is null or (%s))', t.relname, col.attname, parte);
        end if;
        regra := concat_ws(' and ', regra, '(' || parte || ')');
      end loop;
    end if;
    if regra is not null then
      execute format('alter table public.%I enable row level security', t.relname);
      execute format('drop policy if exists carteira_representante_206 on public.%I', t.relname);
      execute format('create policy carteira_representante_206 on public.%I as restrictive for all to authenticated using (not public.escopo_representante() or (%s)) with check (not public.escopo_representante() or (%s))', t.relname, regra, regra);
    end if;
  end loop;
end $$;

-- Preserva assinaturas, ACLs e corpo das RPCs existentes. Marca para reaplicação segura.
do $$
declare r record; a record; guardas text; tabela text; definicao text;
begin
  for r in select p.*, p.oid::regprocedure assinatura from pg_proc p
    join pg_language l on l.oid=p.prolang
    where p.pronamespace='public'::regnamespace and p.prosecdef and l.lanname='plpgsql'
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and position('-- carteira_rpc_206' in p.prosrc)=0
  loop
    guardas := '';
    for a in select unnest(r.proargnames) nome loop
      tabela := case a.nome
        when '_cliente_id' then 'clientes' when '_pessoa_id' then 'pessoas'
        when '_pedido_id' then 'pedidos' when '_conta_receber_id' then 'contas_receber'
        when '_boleto_id' then 'boletos' when '_credito_id' then 'creditos_clientes'
        when '_devolucao_id' then 'devolucoes'
        when '_carga_id' then 'cargas' when '_onda_id' then 'ondas_separacao'
        when '_item_id' then case when r.proname in ('atualizar_item_pedido','remover_item_pedido','registrar_separacao_item') then 'pedido_itens' end
      end;
      if tabela is not null then
        guardas := guardas || format(E'\n if public.escopo_representante() and %I is not null and not public.documento_na_minha_carteira(%L,%I) then raise exception ''Documento fora da sua carteira de representante''; end if;\n',a.nome,tabela,a.nome);
      end if;
    end loop;
    if r.proname = 'criar_pedido_rascunho' then
      guardas := guardas || E'\n if public.escopo_representante() then _representante_id := public.meu_representante_id(); end if;\n';
    end if;
    if guardas <> '' then
      definicao := pg_get_functiondef(r.oid);
      -- O primeiro BEGIN é o bloco externo das funções PL/pgSQL do ERP.
      definicao := regexp_replace(definicao, '\mBEGIN\M', E'BEGIN\n -- carteira_rpc_206\n' || guardas, 'i');
      execute definicao;
    end if;
  end loop;
end $$;

-- Arquivos de remessa/retorno e auditoria contêm várias carteiras no mesmo registro.
-- Cabeçalhos de cargas/ondas só são visíveis se todos os pedidos forem da carteira.
do $$ declare tabela text; regra text; begin
  foreach tabela in array array['sicredi_cnab_arquivos','auditoria','cargas','ondas_separacao'] loop
    if to_regclass('public.' || tabela) is not null then
      regra := 'not public.escopo_representante()';
      if tabela in ('cargas','ondas_separacao') then
        regra := regra || format(' or public.documento_na_minha_carteira(%L,id)',tabela);
      end if;
      execute format('alter table public.%I enable row level security',tabela);
      execute format('drop policy if exists carteira_lote_206 on public.%I',tabela);
      execute format('create policy carteira_lote_206 on public.%I as restrictive for select to authenticated using (%s)',tabela,regra);
    end if;
  end loop;
end $$;

-- Detalhes sem cliente/pedido direto herdam a visibilidade do documento pai.
do $$
declare r record;
begin
  for r in select * from (values
    ('devolucao_itens','devolucao_id','devolucoes'),
    ('tabela_preco_itens','tabela_id','tabelas_preco'),
    ('comissao_pagamento_itens','pagamento_id','comissao_pagamentos'),
    ('pessoa_centros','pessoa_id','pessoas'),
    ('sicredi_boleto_alteracoes','boleto_id','boletos'),
    ('sicredi_cnab_eventos','boleto_id','boletos'),
    ('creditos_clientes_aplicacoes','credito_id','creditos_clientes')
  ) as x(tabela, coluna, pai)
  loop
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name=r.tabela and column_name=r.coluna) then
      execute format('alter table public.%I enable row level security',r.tabela);
      execute format('drop policy if exists carteira_detalhe_206 on public.%I',r.tabela);
      execute format('create policy carteira_detalhe_206 on public.%I as restrictive for all to authenticated using (not public.escopo_representante() or exists (select 1 from public.%I pai where pai.id = %I.%I)) with check (not public.escopo_representante() or exists (select 1 from public.%I pai where pai.id = %I.%I))', r.tabela,r.pai,r.tabela,r.coluna,r.pai,r.tabela,r.coluna);
    end if;
  end loop;
end $$;

-- Views recriadas após fase100 também devem executar com RLS do usuário.
do $$ declare r record; begin
  for r in select relname from pg_class where relnamespace='public'::regnamespace and relkind='v' loop
    execute format('alter view public.%I set (security_invoker = on)',r.relname);
  end loop;
  if to_regprocedure('public.cliente_por_documento(text)') is not null then
    alter function public.cliente_por_documento(text) security invoker;
  end if;
  if to_regprocedure('public.pessoa_por_documento(text)') is not null then
    alter function public.pessoa_por_documento(text) security invoker;
  end if;
end $$;

commit;
