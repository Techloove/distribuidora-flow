-- Fase 16: controle de emissao de boletos (Sicredi) no lugar da nota fiscal
-- Idempotente.

alter table public.boletos add column if not exists pedido_id uuid references public.pedidos(id) on delete set null;
alter table public.boletos add column if not exists documento text;
alter table public.boletos add column if not exists parcela integer;
alter table public.boletos add column if not exists cooperativa text;
alter table public.boletos add column if not exists posto text;
alter table public.boletos add column if not exists codigo_beneficiario text;
alter table public.boletos add column if not exists tipo_cobranca text default 'HIBRIDO';
alter table public.boletos add column if not exists qrcode_pix text;
alter table public.boletos add column if not exists txid text;
alter table public.boletos add column if not exists tentativas integer not null default 0;
alter table public.boletos add column if not exists erro text;
alter table public.boletos add column if not exists ambiente text;
alter table public.boletos add column if not exists enviado_em timestamptz;

alter table public.boletos drop constraint if exists boletos_status_check;
alter table public.boletos add constraint boletos_status_check check (
  status in ('pendente','em_processamento','registrado','liquidado','baixado','cancelado','erro')
);

create index if not exists boletos_conta_idx on public.boletos(conta_receber_id);
create index if not exists boletos_status_idx on public.boletos(status);

-- Parcelas em aberto que ainda nao possuem boleto ativo
create or replace view public.vw_boletos_pendentes as
select
  cr.id                as conta_receber_id,
  cr.pedido_id,
  cr.cliente_id,
  cr.centro_id,
  cr.documento,
  cr.parcela,
  cr.vencimento,
  (cr.valor - coalesce(cr.valor_pago, 0))::numeric(14,2) as saldo,
  cr.valor,
  cr.status            as status_titulo,
  c.razao_social,
  c.cnpj_cpf,
  c.tipo_pessoa,
  c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.uf, c.cep,
  c.email, c.telefone,
  p.numero             as pedido_numero
from public.contas_receber cr
join public.clientes c on c.id = cr.cliente_id
left join public.pedidos p on p.id = cr.pedido_id
where cr.status in ('aberto','parcial')
  and (cr.valor - coalesce(cr.valor_pago, 0)) > 0
  and not exists (
    select 1 from public.boletos b
    where b.conta_receber_id = cr.id
      and b.status in ('pendente','em_processamento','registrado','liquidado')
  );

grant select on public.vw_boletos_pendentes to authenticated;

-- Liquidacao do boleto baixa o titulo correspondente
create or replace function public.liquidar_boleto(_id uuid, _valor numeric default null, _data date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  b public.boletos;
  v numeric;
begin
  select * into b from public.boletos where id = _id;
  if b.id is null then
    raise exception 'Boleto nao encontrado';
  end if;
  v := coalesce(_valor, b.valor);

  update public.boletos
     set status = 'liquidado',
         valor_liquidado = v,
         data_liquidacao = _data
   where id = _id;

  if b.conta_receber_id is not null then
    update public.contas_receber
       set valor_pago = least(valor, coalesce(valor_pago, 0) + v),
           data_pagamento = _data,
           status = case
             when least(valor, coalesce(valor_pago, 0) + v) >= valor then 'pago'
             else 'parcial'
           end
     where id = b.conta_receber_id;
  end if;
end;
$fn$;

grant execute on function public.liquidar_boleto(uuid, numeric, date) to authenticated;
