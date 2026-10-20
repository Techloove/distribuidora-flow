import { escapeHtml } from "./pedido-impressao";
export type LinhaSeparacao = Record<string, unknown>;
export function linhasCompletasSelecionadas(linhas: LinhaSeparacao[], ids: string[]) {
  const permitidos = new Set(ids);
  const itens = new Map<string, LinhaSeparacao>();
  for (const r of linhas) {
    if (!permitidos.has(String(r["pedido_id"]))) continue;
    const key = `${r["pedido_id"]}:${r["item_id"]}`;
    if (!r["item_id"] || !r["produto_id"])
      throw new Error("Não foi possível identificar todos os itens da separação.");
    const anterior = itens.get(key);
    if (
      anterior &&
      (Number(anterior["quantidade"]) !== Number(r["quantidade"]) ||
        anterior["produto_id"] !== r["produto_id"])
    )
      throw new Error("Há informações divergentes para o mesmo item. Atualize a separação.");
    itens.set(key, r);
  }
  if (new Set([...itens.values()].map((r) => String(r["pedido_id"]))).size !== permitidos.size)
    throw new Error("Nem todos os pedidos selecionados estão disponíveis. Atualize a lista.");
  return [...itens.values()];
}
export function agruparItensSeparacao(linhas: LinhaSeparacao[]) {
  const map = new Map<
    string,
    {
      codigo: string;
      produto: string;
      unidade: string;
      quantidade: number;
      separada: number;
      pedidos: Set<string>;
    }
  >();
  for (const r of linhas) {
    const key = `${r["produto_id"]}:${r["unidade"] ?? ""}`;
    const atual = map.get(key) ?? {
      codigo: String(r["produto_codigo"] ?? "—"),
      produto: String(r["produto"] ?? ""),
      unidade: String(r["unidade"] ?? "—"),
      quantidade: 0,
      separada: 0,
      pedidos: new Set<string>(),
    };
    const quantidade = Number(r["quantidade"]),
      separada = Number(r["quantidade_separada"] ?? 0);
    if (
      !Number.isFinite(quantidade) ||
      !Number.isFinite(separada) ||
      quantidade < 0 ||
      separada < 0
    )
      throw new Error("Quantidades inválidas no relatório.");
    atual.quantidade = Math.round((atual.quantidade + quantidade) * 1000) / 1000;
    atual.separada = Math.round((atual.separada + separada) * 1000) / 1000;
    atual.pedidos.add(String(r["numero"]));
    map.set(key, atual);
  }
  return [...map.values()].sort(
    (a, b) =>
      a.produto.localeCompare(b.produto, "pt-BR") ||
      a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }),
  );
}
export function gerarRelatorioSeparacao(
  linhas: LinhaSeparacao[],
  ids: string[],
  modo: "consolidado" | "cliente",
) {
  const completas = linhasCompletasSelecionadas(linhas, ids);
  const grupos = new Map<string, { nome: string; linhas: LinhaSeparacao[] }>();
  for (const r of completas) {
    const key = modo === "consolidado" ? "todos" : String(r["cliente_id"] ?? r["pedido_id"]);
    const grupo = grupos.get(key) ?? {
      nome:
        modo === "consolidado"
          ? "Todos os clientes — coleta consolidada"
          : String(r["cliente"] ?? "Cliente"),
      linhas: [],
    };
    grupo.linhas.push(r);
    grupos.set(key, grupo);
  }
  const numero = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const blocos = [...grupos.values()]
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((g) => {
      const itens = agruparItensSeparacao(g.linhas);
      const lojas = [...new Set(g.linhas.map((r) => String(r["centro"] ?? "—")))].join(", ");
      const pedidos = [...new Set(g.linhas.map((r) => String(r["numero"])))].join(", ");
      return `<section><h2>${escapeHtml(g.nome)}</h2><p>Lojas: ${escapeHtml(lojas)} · Pedidos: ${escapeHtml(pedidos)}</p><table><thead><tr><th>Código</th><th>Produto</th><th>Un.</th><th>Quantidade</th><th>Já separada</th><th>Conferência</th><th>Pedidos</th></tr></thead><tbody>${itens.map((i) => `<tr><td>${escapeHtml(i.codigo)}</td><td>${escapeHtml(i.produto)}</td><td>${escapeHtml(i.unidade)}</td><td class="num">${numero(i.quantidade)}</td><td class="num">${numero(i.separada)}</td><td>☐ __________</td><td>${escapeHtml([...i.pedidos].join(", "))}</td></tr>`).join("")}</tbody></table><p>Separador: ____________________ Conferente: ____________________</p></section>`;
    })
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Separação — ${modo === "cliente" ? "por cliente" : "consolidada"}</title><style>body{font:12px Arial;color:#132431;margin:20px}h1{font-size:20px}h2{font-size:16px}p{line-height:1.5}table{border-collapse:collapse;width:100%}th,td{padding:8px;border:1px solid #bbb;text-align:left}.num{text-align:right}thead{display:table-header-group}tr{break-inside:avoid}section{margin:24px 0}@media print{section+section{break-before:page}body{margin:0}}@page{size:A4 landscape;margin:12mm}</style></head><body><h1>Separação e conferência ${modo === "cliente" ? "por cliente" : "consolidada por produto"}</h1><p>${ids.length} pedido(s) selecionado(s). Emitido em ${escapeHtml(new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }))}. Quantidades por unidade; itens completos dos pedidos selecionados.</p>${blocos}</body></html>`;
}
