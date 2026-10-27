export type TipoReferencia =
  | "cliente"
  | "fornecedor"
  | "pessoa"
  | "pedido"
  | "receber"
  | "pagar"
  | "boleto"
  | "financeiroPedido"
  | "boletosPedido"
  | "clientePedido";

export function idReferencia(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
    ? value
    : undefined;
}

export function destinoReferencia(tipo: TipoReferencia, value: unknown) {
  const id = idReferencia(value);
  if (!id) return null;
  switch (tipo) {
    case "clientePedido":
      return { to: "/pessoas" as const, search: { pedido: id } };
    case "cliente":
      return { to: "/pessoas" as const, search: { cliente: id } };
    case "fornecedor":
      return { to: "/pessoas" as const, search: { fornecedor: id } };
    case "pessoa":
      return { to: "/pessoas" as const, search: { pessoa: id } };
    case "pedido":
      return { to: "/pedidos" as const, search: { pedido: id } };
    case "receber":
      return { to: "/receber" as const, search: { titulo: id } };
    case "pagar":
      return { to: "/pagar" as const, search: { titulo: id } };
    case "financeiroPedido":
      return { to: "/receber" as const, search: { pedido: id } };
    case "boletosPedido":
      return { to: "/boletos" as const, search: { pedido: id } };
    case "boleto":
      return { to: "/boletos" as const, search: { boleto: id } };
  }
}

export type BuscaReferencias = {
  titulo?: string | undefined;
  pedido?: string | undefined;
  cliente?: string | undefined;
  boleto?: string | undefined;
};

export function buscaReferencias(search: Record<string, unknown>): BuscaReferencias {
  return {
    titulo: idReferencia(search["titulo"]),
    pedido: idReferencia(search["pedido"]),
    cliente: idReferencia(search["cliente"]),
    boleto: idReferencia(search["boleto"]),
  };
}

export function correspondeReferencia(
  row: Record<string, unknown>,
  busca: BuscaReferencias,
  boleto = false,
) {
  return (
    (!busca.titulo || row[boleto ? "conta_receber_id" : "id"] === busca.titulo) &&
    (!busca.pedido || row["pedido_id"] === busca.pedido) &&
    (!busca.cliente || row["cliente_id"] === busca.cliente) &&
    (!busca.boleto || (boleto && row["id"] === busca.boleto))
  );
}
