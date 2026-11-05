export type AlertaEstoquePedido = {
  item_id: string;
  estoque_disponivel: number;
  quantidade_pedido: number;
  insuficiente: boolean;
};
/** Aviso informativo: não altera nem substitui a aprovação comercial do servidor. */
export function avisoEstoquePedido(alerta: AlertaEstoquePedido | undefined, status: unknown) {
  if (!alerta?.insuficiente) return null;
  const numero = (v: number) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const detalhe = `Disponível para o pedido: ${numero(alerta.estoque_disponivel)} · solicitado: ${numero(alerta.quantidade_pedido)}.`;
  if (status === "aguardando_aprovacao")
    return `Aguardando aprovação comercial · estoque insuficiente. ${detalhe}`;
  if (status === "aprovado")
    return `Estoque insuficiente · aprovação comercial registrada. ${detalhe} A confirmação segue as regras de estoque.`;
  return `Estoque insuficiente · item mantido no pedido para análise comercial. ${detalhe}`;
}
