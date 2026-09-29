-- Fase 51: verificações de consistência de integração.
-- IMPORTANTE: esta migração NÃO altera dados de produção.
-- Correções dependentes de IDs/números específicos devem ser executadas como
-- operação de saneamento explicitamente revisada, nunca como migration estrutural.
--
-- Motivo: migrations devem ser determinísticas e seguras para qualquer banco.
-- A versão anterior alterava pedidos por número fixo (5 e 13) e ajustava
-- estoque histórico globalmente, o que poderia modificar dados legítimos
-- de outra instalação.

do $$
begin
  if to_regclass('public.pedidos') is null then
    raise notice 'Tabela pedidos ainda não existe; nenhuma verificação executada.';
    return;
  end if;

  raise notice 'Fase 51 carregada em modo somente verificação. Nenhum dado foi alterado.';
end $$;

-- Consultas opcionais para revisão manual:
-- select p.numero, p.id, p.centro_id, p.total_liquido
--   from public.pedidos p
--  where p.status <> 'rascunho'
--  order by p.numero;
--
-- select p.id, p.numero,
--        p.total_liquido,
--        coalesce(sum(c.valor) filter (where c.status <> 'cancelado'), 0) total_receber
--   from public.pedidos p
--   left join public.contas_receber c on c.pedido_id = p.id
--  group by p.id, p.numero, p.total_liquido
--  having abs(p.total_liquido - coalesce(sum(c.valor) filter (where c.status <> 'cancelado'), 0)) > 0.01;
