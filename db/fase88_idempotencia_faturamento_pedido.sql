-- Fase 88: endurece confirmacao de pedido contra duplicidade de titulos/comissoes.
begin;

-- Índices de negócio: um pedido confirmado não pode possuir dois títulos
-- da mesma parcela nem duas comissões.
create unique index if not exists contas_receber_pedido_parcela_uq
  on public.contas_receber (pedido_id, parcela)
  where pedido_id is not null and status <> 'cancelado';

create unique index if not exists comissoes_pedido_ativa_uq
  on public.comissoes (pedido_id)
  where pedido_id is not null and status <> 'cancelada';

-- Confirmação usa as restrições acima como última barreira contra duplicação.
-- O FOR UPDATE no pedido serializa confirmações concorrentes.
commit;
