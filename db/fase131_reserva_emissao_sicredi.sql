-- Fase 131: reserva server-side da emissão Sicredi.
-- Evita chamadas bancárias duplicadas em concorrência e permite reemissão após baixa
-- com um novo "seu número" controlado pelo ERP.
begin;

-- Antes de impor unicidade, falha de forma legível se o legado já tiver duplicidade ativa.
do $$
declare
  duplicados bigint;
begin
  select count(*) into duplicados
  from (
    select conta_receber_id
    from public.boletos
    where conta_receber_id is not null
      and status in ('pendente','em_processamento','registrado','liquidado')
    group by conta_receber_id
    having count(*) > 1
  ) d;

  if duplicados > 0 then
    raise exception 'Fase 131: existem % títulos com mais de um boleto ativo; concilie antes de aplicar a migration', duplicados;
  end if;
end $$;

create unique index if not exists boletos_conta_ativa_uq
  on public.boletos(conta_receber_id)
  where conta_receber_id is not null
    and status in ('pendente','em_processamento','registrado','liquidado');

create or replace function public.preparar_boleto_sicredi_servidor(
  _actor_id uuid,
  _conta_id uuid
) returns public.boletos
language plpgsql
security definer
set search_path = public
as $$
declare
  cr public.contas_receber;
  b public.boletos;
  saldo numeric(14,2);
  v_seu_numero text;
  tentativa integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Operacao exclusiva do servidor';
  end if;

  select * into cr
  from public.contas_receber
  where id=_conta_id
  for update;

  if cr.id is null then raise exception 'Titulo nao encontrado'; end if;
  if not public.ator_financeiro_pode_acessar_centro(_actor_id,cr.centro_id) then
    raise exception 'Usuario sem permissao para o centro do titulo';
  end if;
  if cr.status not in ('aberto','parcial') then
    raise exception 'Titulo nao pode receber boleto no status atual';
  end if;

  saldo := round(
    coalesce(cr.valor,0)+coalesce(cr.juros,0)+coalesce(cr.multa,0)+coalesce(cr.acrescimo,0)
    -coalesce(cr.desconto,0)-coalesce(cr.valor_pago,0),2
  );
  if saldo <= 0 then raise exception 'Titulo sem saldo para cobranca'; end if;

  -- Uma emissão ativa impede uma segunda chamada ao banco.
  select * into b
  from public.boletos
  where conta_receber_id=cr.id
    and status in ('pendente','em_processamento','registrado','liquidado')
  order by created_at desc
  limit 1
  for update;

  if b.id is not null then
    if b.status='liquidado' then
      raise exception 'Titulo ja possui boleto liquidado';
    end if;
    if b.status='registrado' then
      raise exception 'Titulo ja possui boleto registrado';
    end if;

    if b.status in ('pendente','em_processamento')
       and coalesce(b.enviado_em,b.created_at) >= now() - interval '10 minutes' then
      raise exception 'Emissao deste boleto ja esta em processamento';
    end if;

    -- Reserva antiga/stale: retoma o mesmo seu numero para um retry seguro.
    update public.boletos
    set status='em_processamento',
        enviado_em=now(),
        erro=null,
        tentativas=coalesce(tentativas,0)+1,
        valor=saldo,
        vencimento=cr.vencimento
    where id=b.id
    returning * into b;

    return b;
  end if;

  -- Reutiliza um identificador somente se o ÚLTIMO ciclo deste título terminou em erro.
  -- Assim uma reemissão posterior a boleto baixado/cancelado nunca ressuscita um número antigo.
  b := null;
  select * into b
  from public.boletos
  where conta_receber_id=cr.id
  order by created_at desc
  limit 1
  for update;

  if b.id is not null
     and b.status='erro'
     and nullif(btrim(b.seu_numero),'') is not null then
    update public.boletos
    set status='em_processamento',
        enviado_em=now(),
        erro=null,
        tentativas=coalesce(tentativas,0)+1,
        valor=saldo,
        vencimento=cr.vencimento
    where id=b.id
    returning * into b;

    return b;
  end if;

  -- Novo ciclo (inclusive após boleto baixado/cancelado): aloca um seuNumero numérico de 10 dígitos, com baixa probabilidade de colisão também contra históricos bancários fora deste ERP.
  v_seu_numero := null;
  for tentativa in 1..50 loop
    v_seu_numero := (1000000000 + abs(hashtextextended(gen_random_uuid()::text,0) % 9000000000))::text;
    exit when not exists (
      select 1 from public.boletos
      where banco='sicredi' and seu_numero=v_seu_numero
    );
    v_seu_numero := null;
  end loop;

  if v_seu_numero is null then
    raise exception 'Nao foi possivel alocar identificador unico para o boleto';
  end if;

  insert into public.boletos(
    conta_receber_id,cliente_id,centro_id,pedido_id,documento,parcela,banco,
    seu_numero,valor,vencimento,status,tentativas,enviado_em,created_by
  ) values(
    cr.id,cr.cliente_id,cr.centro_id,cr.pedido_id,cr.documento,cr.parcela,'sicredi',
    v_seu_numero,saldo,cr.vencimento,'em_processamento',1,now(),_actor_id
  )
  returning * into b;

  insert into public.auditoria(tabela,registro_id,acao,detalhe,user_id)
  values(
    'boletos',b.id,'preparar_sicredi_servidor',
    jsonb_build_object('conta_receber_id',cr.id,'seu_numero',b.seu_numero),
    _actor_id
  );

  return b;
end;
$$;

revoke execute on function public.preparar_boleto_sicredi_servidor(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.preparar_boleto_sicredi_servidor(uuid,uuid)
  to service_role;

-- Reservas abandonadas voltam a aparecer para retry depois de 10 minutos.
create or replace view public.vw_boletos_pendentes
with (security_invoker = on)
as
select
  cr.id as conta_receber_id,
  cr.pedido_id,
  cr.cliente_id,
  cr.centro_id,
  cr.documento,
  cr.parcela,
  cr.vencimento,
  (coalesce(cr.valor,0)+coalesce(cr.juros,0)+coalesce(cr.multa,0)+coalesce(cr.acrescimo,0)-coalesce(cr.desconto,0)-coalesce(cr.valor_pago,0))::numeric(14,2) as saldo,
  cr.valor,
  cr.status as status_titulo,
  c.razao_social,
  c.cnpj_cpf,
  c.tipo_pessoa,
  c.logradouro,
  c.numero,
  c.complemento,
  c.bairro,
  c.cidade,
  c.uf,
  c.cep,
  c.email,
  c.telefone,
  p.numero as pedido_numero
from public.contas_receber cr
join public.clientes c on c.id=cr.cliente_id
left join public.pedidos p on p.id=cr.pedido_id
where cr.status in ('aberto','parcial')
  and (coalesce(cr.valor,0)+coalesce(cr.juros,0)+coalesce(cr.multa,0)+coalesce(cr.acrescimo,0)-coalesce(cr.desconto,0)-coalesce(cr.valor_pago,0)) > 0
  and not exists (
    select 1
    from public.boletos b
    where b.conta_receber_id=cr.id
      and (
        b.status in ('pendente','registrado','liquidado')
        or (
          b.status='em_processamento'
          and coalesce(b.enviado_em,b.created_at) >= now() - interval '10 minutes'
        )
      )
  );

grant select on public.vw_boletos_pendentes to authenticated;

-- Preflight do novo perímetro.
do $$
declare
  r regprocedure := to_regprocedure('public.preparar_boleto_sicredi_servidor(uuid,uuid)');
  opts text[];
begin
  if r is null then
    raise exception 'Fase 131: preparar_boleto_sicredi_servidor ausente';
  end if;

  if has_function_privilege('anon',r,'EXECUTE')
     or has_function_privilege('authenticated',r,'EXECUTE')
     or not has_function_privilege('service_role',r,'EXECUTE') then
    raise exception 'Fase 131: perímetro incorreto na preparação server-only do boleto';
  end if;

  select c.reloptions into opts
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='vw_boletos_pendentes'
    and c.relkind='v';

  -- O Postgres normaliza o valor como on/true; aceita ambas as formas.
  if not (coalesce(opts,array[]::text[]) && array['security_invoker=true','security_invoker=on']) then
    raise exception 'Fase 131: vw_boletos_pendentes sem security_invoker';
  end if;
end $$;

commit;
