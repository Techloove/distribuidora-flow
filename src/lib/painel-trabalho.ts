/** Perfil visual segue a mesma exceção de administrador usada pela carteira. */
export function perfilPainel(roles: readonly string[]) {
  if (roles.includes("admin")) return "gestao";
  if (roles.includes("representante")) return "representante";
  if (roles.includes("gestor")) return "gestao";
  if (roles.includes("financeiro")) return "financeiro";
  return "operacao";
}
export function hojeSaoPaulo(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export type PedidoConferencia = {
  cliente_id?: unknown;
  centro_id?: unknown;
  rota_id?: unknown;
  forma_pagamento_id?: unknown;
  total_liquido?: unknown;
};
export function conferirPedido(doc: PedidoConferencia, itens: readonly Record<string, unknown>[]) {
  const avisos: string[] = [];
  for (const [key, label] of [
    ["cliente_id", "Cliente"],
    ["centro_id", "Centro de custo"],
    ["rota_id", "Rota de entrega"],
    ["forma_pagamento_id", "Forma de pagamento"],
  ] as const) {
    if (!doc[key]) avisos.push(`${label}: preenchimento obrigatório.`);
  }
  if (!itens.length) avisos.push("Adicione ao menos um item ao pedido.");
  if (
    itens.some(
      (i) =>
        !Number.isFinite(Number(i["quantidade"])) ||
        Number(i["quantidade"]) <= 0 ||
        !Number.isFinite(Number(i["preco_unitario"])) ||
        Number(i["preco_unitario"]) < 0,
    )
  )
    avisos.push("Confira a quantidade e o preço dos itens.");
  if (!Number.isFinite(Number(doc.total_liquido)) || Number(doc.total_liquido) <= 0)
    avisos.push("O total do pedido deve ser maior que zero.");
  return avisos;
}
