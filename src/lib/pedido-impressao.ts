export type PrintRow = Record<string, unknown>;
export type PedidoImpressao = {
  pedido: PrintRow;
  cliente: PrintRow;
  empresa: PrintRow;
  centro: PrintRow;
  representante: PrintRow;
  forma: PrintRow;
  itens: { item: PrintRow; produto: PrintRow }[];
};

export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
const number = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const money = (value: unknown) =>
  number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const quantity = (value: unknown) =>
  number(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
export function pesoItemImpressao(item: PrintRow, produto: PrintRow) {
  // A quantidade de produtos vendidos em KG já representa o peso quando não há peso unitário cadastrado.
  const unitWeight = number(produto["peso_kg"]);
  return (
    number(item["quantidade"]) *
    (unitWeight > 0 ? unitWeight : String(produto["unidade"] ?? "").toUpperCase() === "KG" ? 1 : 0)
  );
}
export function pesoPedidoImpressao(data: PedidoImpressao) {
  return data.itens.reduce(
    (total, { item, produto }) => total + pesoItemImpressao(item, produto),
    0,
  );
}
const field = (label: string, value: unknown, wide = false) =>
  `<div${wide ? ' class="wide"' : ""}><strong>${label}:</strong> ${escapeHtml(value || "—")}</div>`;
const address = (r: PrintRow) =>
  [r["logradouro"], r["numero"], r["complemento"]].filter(Boolean).join(", ");

export function gerarHtmlPedidos(dados: PedidoImpressao[], css: string) {
  const sheets = dados
    .map((data) => {
      const { pedido: p, cliente: c, empresa: e, centro, representante, forma, itens } = data;
      const date = String(p["data_pedido"] ?? "")
        .slice(0, 10)
        .split("-")
        .reverse()
        .join("/");
      const company =
        e["nome_fantasia"] || e["razao_social"] || centro["nome"] || "Pedido de venda";
      const totalItems = itens.reduce(
        (sum, { item }) =>
          sum +
          (item["total"] != null
            ? number(item["total"])
            : Math.round(
                number(item["quantidade"]) *
                  number(item["preco_unitario"]) *
                  (1 - number(item["desconto_percentual"]) / 100) *
                  100,
              ) / 100),
        0,
      );
      const lines = itens
        .map(
          ({ item, produto }) =>
            `<tr><td class="num">${quantity(item["quantidade"])}</td><td>${escapeHtml(produto["unidade"] || "—")}</td><td>${escapeHtml(produto["descricao"] || "Produto não informado")}</td><td class="num">${money(item["preco_unitario"])}</td><td class="num">${quantity(item["desconto_percentual"])}%</td><td class="num">${money(item["total"] ?? Math.round(number(item["quantidade"]) * number(item["preco_unitario"]) * (1 - number(item["desconto_percentual"]) / 100) * 100) / 100)}</td></tr>`,
        )
        .join("");
      const adjustments = [
        ["Desconto", p["desconto_valor"]],
        ["Desconto da forma", p["forma_desconto_valor"]],
        ["Acréscimo da forma", p["forma_acrescimo_valor"]],
        ["Frete", p["frete_valor"]],
      ]
        .filter(([, v]) => number(v) !== 0)
        .map(([label, v]) => `<div><span>${label}</span><span>${money(v)}</span></div>`)
        .join("");
      return `<article class="order-sheet"><div class="company"><h1>${escapeHtml(company)}</h1><p>${escapeHtml([e["telefone"] && `Telefone: ${e["telefone"]}`, e["email"] && `E-mail: ${e["email"]}`].filter(Boolean).join(" · "))}</p><p>${escapeHtml([e["cnpj"] && `CNPJ: ${e["cnpj"]}`, address(e), e["cidade"], e["uf"]].filter(Boolean).join(" · "))}</p></div><div class="order-heading"><span>Data: ${escapeHtml(date || "—")}</span><strong>PEDIDO Nº ${escapeHtml(p["numero"])}</strong></div><div class="customer">${field("Cliente", [c["codigo"], c["razao_social"]].filter(Boolean).join(" - "), true)}${field("Endereço", address(c), true)}${field("Bairro", c["bairro"])}${field("Telefone", c["telefone"])}${field("Cidade / UF", [c["cidade"], c["uf"]].filter(Boolean).join(" / "))}${field("CEP", c["cep"])}${field("CNPJ / CPF", c["cnpj_cpf"])}${field("Inscrição estadual", c["inscricao_estadual"])}${field("Empresa / centro", centro["nome"], true)}</div><div class="notes">${field("Vendedor", representante["nome"])}${field("Pagamento", [forma["nome"], p["parcelas"] && `${p["parcelas"]} parcela(s)`].filter(Boolean).join(" · "))}${field("Obs.", p["observacoes"])}</div><h2>DESCRIÇÃO DOS PRODUTOS</h2><table><colgroup><col style="width:9%"><col style="width:6%"><col style="width:40%"><col style="width:16%"><col style="width:10%"><col style="width:19%"></colgroup><thead><tr><th class="num">Quant.</th><th>Un.</th><th>Descrição</th><th class="num">Preço unit.</th><th class="num">Desc.</th><th class="num">Preço total</th></tr></thead><tbody>${lines}</tbody></table><div class="totals"><div><span>Subtotal dos itens</span><span>${money(p["total_itens"] ?? totalItems)}</span></div>${adjustments}<div class="grand-total"><span>TOTAL</span><span>${money(p["total_liquido"] ?? totalItems)}</span></div><div class="weight-total"><span>PESO TOTAL</span><span>${quantity(pesoPedidoImpressao(data))} kg</span></div></div><div class="signature">Assinatura</div><footer>Pedido nº ${escapeHtml(p["numero"])} · ${escapeHtml(c["razao_social"])} — Documento de pedido, sem valor fiscal.</footer></article>`;
    })
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Impressão de pedidos</title><style>${css}</style></head><body>${sheets}</body></html>`;
}
