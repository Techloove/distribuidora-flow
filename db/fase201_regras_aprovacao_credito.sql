-- Fase 201: regras configuráveis de aprovação por crédito do cliente.
-- Pedido acima do limite ou com títulos vencidos vai para aprovação.
-- Título que vence em sábado, domingo ou feriado só conta como vencido após o 1º dia útil seguinte.
begin;

insert into public.parametros (chave, valor, descricao) values
  ('aprovacao_limite_credito', 'true', 'Enviar para aprovação pedido acima do limite de crédito do cliente (true/false)'),
  ('aprovacao_titulos_vencidos', 'true', 'Enviar para aprovação pedido de cliente com títulos vencidos (true/false)'),
  ('vencimento_fim_semana_feriado', 'true', 'Não considerar vencido título que vence em sábado, domingo ou feriado até o próximo dia útil (true/false)'),
  ('tolerancia_dias_vencidos', '0', 'Dias de tolerância após o vencimento antes de enviar para aprovação')
on conflict (chave) do nothing;

create table if not exists public.feriados (
  data date primary key,
  descricao text not null
);
grant select on public.feriados to authenticated;
grant all on public.feriados to service_role;
alter table public.feriados enable row level security;
drop policy if exists feriados_select on public.feriados;
create policy feriados_select on public.feriados for select to authenticated using (true);

create or replace function public.pascoa(_ano int)
returns date language plpgsql immutable set search_path = public as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mes int; dia int;
begin
  a := _ano % 19; b := _ano / 100; c := _ano % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19*a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2*e + 2*i - h - k) % 7; m := (a + 11*h + 22*l) / 451;
  mes := (h + l - 7*m + 114) / 31; dia := ((h + l - 7*m + 114) % 31) + 1;
  return make_date(_ano, mes, dia);
end $$;

create or replace function public.eh_dia_util(_d date)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare p date := public.pascoa(extract(year from _d)::int); md text := to_char(_d, 'MM-DD');
begin
  if extract(isodow from _d) in (6, 7) then return false; end if;
  if md in ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25') then return false; end if;
  if _d in (p - 48, p - 47, p - 2, p + 60) then return false; end if; -- carnaval, sexta santa, corpus christi
  if exists (select 1 from public.feriados where data = _d) then return false; end if;
  return true;
end $$;

create or replace function public.vencimento_util(_d date)
returns date language plpgsql stable security definer set search_path = public as $$
declare d date := _d; n int := 0;
begin
  if d is null then return null; end if;
  while not public.eh_dia_util(d) and n < 15 loop d := d + 1; n := n + 1; end loop;
  return d;
end $$;

create or replace function public.validar_pedido(_pedido_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  ped record; cli record;
  res jsonb := '[]'::jsonb;
  vencidos numeric(14,2); aberto numeric(14,2);
  margem numeric(14,4); custo numeric(14,4);
  margem_min numeric := coalesce((select valor::numeric from public.parametros where chave = 'margem_minima'), 10);
  desc_max numeric := coalesce((select valor::numeric from public.parametros where chave = 'desconto_maximo'), 15);
  regra_limite boolean := coalesce((select valor from public.parametros where chave = 'aprovacao_limite_credito'), 'true') = 'true';
  regra_vencidos boolean := coalesce((select valor from public.parametros where chave = 'aprovacao_titulos_vencidos'), 'true') = 'true';
  regra_util boolean := coalesce((select valor from public.parametros where chave = 'vencimento_fim_semana_feriado'), 'true') = 'true';
  tolerancia int := coalesce((select nullif(valor,'')::int from public.parametros where chave = 'tolerancia_dias_vencidos'), 0);
  item record;
begin
  select * into ped from public.pedidos where id = _pedido_id;
  if ped is null then return res; end if;
  select * into cli from public.clientes where id = ped.cliente_id;

  select coalesce(sum(valor - coalesce(valor_pago,0)), 0) into vencidos
    from public.contas_receber
   where cliente_id = ped.cliente_id and status not in ('pago','cancelado')
     and (case when regra_util then public.vencimento_util(vencimento) else vencimento end) + tolerancia < current_date;
  select coalesce(sum(valor - coalesce(valor_pago,0)), 0) into aberto
    from public.contas_receber
   where cliente_id = ped.cliente_id and status not in ('pago','cancelado');

  if cli.status = 'bloqueado' then
    res := res || jsonb_build_object('nivel','bloqueio','mensagem','Cliente bloqueado no cadastro');
  end if;
  if regra_vencidos and vencidos > 0 then
    res := res || jsonb_build_object('nivel','bloqueio',
      'mensagem','Cliente possui ' || to_char(vencidos,'FM999999990.00') || ' em títulos vencidos');
  end if;
  if regra_limite and coalesce(cli.limite_credito,0) > 0 and (aberto + ped.total_liquido) > cli.limite_credito then
    res := res || jsonb_build_object('nivel','bloqueio',
      'mensagem','Limite de crédito excedido (limite ' || to_char(cli.limite_credito,'FM999999990.00')
        || ', exposição ' || to_char(aberto + ped.total_liquido,'FM999999990.00') || ')');
  end if;
  if ped.forma_pagamento_id is null then
    res := res || jsonb_build_object('nivel','alerta','mensagem','Forma de pagamento não informada');
  end if;
  if ped.centro_id is null then
    res := res || jsonb_build_object('nivel','alerta','mensagem','Centro de custo não informado');
  end if;

  for item in
    select pi.quantidade, pi.preco_unitario, pi.desconto_percentual,
           p.descricao, p.estoque_atual, p.custo_medio, p.margem_minima
      from public.pedido_itens pi join public.produtos p on p.id = pi.produto_id
     where pi.pedido_id = _pedido_id
  loop
    if item.quantidade > coalesce(item.estoque_atual,0) then
      res := res || jsonb_build_object('nivel','alerta',
        'mensagem','Estoque insuficiente de ' || item.descricao ||
          ' (disponível ' || to_char(coalesce(item.estoque_atual,0),'FM999999990.###') || ')');
    end if;
    custo := coalesce(item.custo_medio, 0);
    if custo > 0 and item.preco_unitario > 0 then
      margem := round(((item.preco_unitario * (1 - coalesce(item.desconto_percentual,0)/100) / custo) - 1) * 100, 2);
      if margem < greatest(coalesce(item.margem_minima,0), margem_min) then
        res := res || jsonb_build_object('nivel','bloqueio',
          'mensagem','Margem de ' || item.descricao || ' abaixo do mínimo (' || margem || '%)');
      end if;
    end if;
    if coalesce(item.desconto_percentual,0) > desc_max then
      res := res || jsonb_build_object('nivel','bloqueio',
        'mensagem','Desconto de ' || item.descricao || ' acima do máximo permitido (' || desc_max || '%)');
    end if;
  end loop;
  return res;
end $function$;

revoke all on function public.pascoa(int) from public, anon;
revoke all on function public.eh_dia_util(date) from public, anon;
revoke all on function public.vencimento_util(date) from public, anon;
grant execute on function public.pascoa(int) to authenticated;
grant execute on function public.eh_dia_util(date) to authenticated;
grant execute on function public.vencimento_util(date) to authenticated;

commit;
