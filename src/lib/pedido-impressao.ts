import { brl as money } from "@/lib/formatacao";
import { logoLojaValida } from "@/lib/identidade-loja";
import { nomeStatusPedido, statusVisivelPedido } from "@/lib/status-pedido";
export type PrintRow = Record<string, unknown>;
export type PedidoImpressao = {
  pedido: PrintRow;
  cliente: PrintRow;
  empresa: PrintRow;
  centro: PrintRow;
  representante: PrintRow;
  rota?: PrintRow;
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
      const orcamento = p["tipo_documento"] === "orcamento";
      const tipoBase = orcamento ? "ORÇAMENTO" : "PEDIDO";
      const tipo =
        p["modalidade_venda"] === "intermediacao" ? `${tipoBase} • INTERMEDIAÇÃO` : tipoBase;
      const validade = String(p["orcamento_validade"] ?? "")
        .slice(0, 10)
        .split("-")
        .reverse()
        .join("/");
      const date = String(
        (orcamento ? p["orcamento_data"] : p["data_pedido"]) ?? p["data_pedido"] ?? "",
      )
        .slice(0, 10)
        .split("-")
        .reverse()
        .join("/");
      const company =
        e["nome_fantasia"] || e["razao_social"] || centro["nome"] || "Pedido de venda";
      const logo = logoLojaValida(e["logo_url"]);
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
            `<tr><td>${escapeHtml(String(produto["codigo"] ?? "").trim() || "—")}</td><td class="num">${quantity(item["quantidade"])}</td><td>${escapeHtml(produto["unidade"] || "—")}</td><td>${escapeHtml(produto["descricao"] || "Produto não informado")}</td><td class="num">${money(item["preco_unitario"])}</td><td class="num">${quantity(item["desconto_percentual"])}%</td><td class="num">${money(item["total"] ?? Math.round(number(item["quantidade"]) * number(item["preco_unitario"]) * (1 - number(item["desconto_percentual"]) / 100) * 100) / 100)}</td></tr>`,
        )
        .join("");
      const adjustments = [
        ["Desconto", p["desconto_valor"]],
        ["Desconto da forma", p["forma_desconto_valor"]],
        ["Acréscimo da forma", p["forma_acrescimo_valor"]],
        ["Frete manual", p["frete_valor"]],
        ["Frete por volume", p["frete_volume_valor"]],
        ["Outras despesas", p["outras_despesas"]],
      ]
        .filter(([, v]) => number(v) !== 0)
        .map(([label, v]) => `<div><span>${label}</span><span>${money(v)}</span></div>`)
        .join("");
      return `<article class="order-sheet"><div class="company">${logo ? `<img src="${escapeHtml(logo)}" alt="Logo da loja" style="max-width:180px;max-height:80px;object-fit:contain" referrerpolicy="no-referrer" />` : ""}<h1>${escapeHtml(company)}</h1><p>${escapeHtml([e["telefone"] && `Telefone: ${e["telefone"]}`, e["email"] && `E-mail: ${e["email"]}`].filter(Boolean).join(" · "))}</p><p>${escapeHtml([e["cnpj"] && `CNPJ: ${e["cnpj"]}`, address(e), e["cidade"], e["uf"]].filter(Boolean).join(" · "))}</p></div><div class="order-heading"><span>Data: ${escapeHtml(date || "—")}</span><strong>${tipo} Nº ${escapeHtml(p["numero"])}</strong></div><div class="customer">${field("Cliente", [c["codigo"], c["razao_social"]].filter(Boolean).join(" - "), true)}${field("Nome fantasia", c["nome_fantasia"], true)}${field("Endereço", address(c), true)}${field("Bairro", c["bairro"])}${field("Telefone", c["telefone"])}${field("Cidade / UF", [c["cidade"], c["uf"]].filter(Boolean).join(" / "))}${field("CEP", c["cep"])}${field("CNPJ / CPF", c["cnpj_cpf"])}${field("Inscrição estadual", c["inscricao_estadual"])}${field("Loja", centro["nome"], true)}</div><div class="notes">${orcamento ? field("Validade da proposta", validade) + field("Situação", nomeStatusPedido(statusVisivelPedido(p))) : ""}${field("Representante", representante["nome"]) + field("Rota", data.rota?.["nome"])}${field("Pagamento", [forma["nome"], p["parcelas"] && `${p["parcelas"]} parcela(s)`].filter(Boolean).join(" · "))}</div><h2>DESCRIÇÃO DOS PRODUTOS</h2><table><colgroup><col style="width:10%"><col style="width:8%"><col style="width:5%"><col style="width:32%"><col style="width:16%"><col style="width:9%"><col style="width:20%"></colgroup><thead><tr><th>Código</th><th class="num">Quant.</th><th>Un.</th><th>Descrição</th><th class="num">Preço unit.</th><th class="num">Desc.</th><th class="num">Preço total</th></tr></thead><tbody>${lines}</tbody></table><div class="totals"><div><span>Subtotal dos itens</span><span>${money(p["total_itens"] ?? totalItems)}</span></div>${adjustments}<div class="grand-total"><span>TOTAL</span><span>${money(p["total_liquido"] ?? totalItems)}</span></div><div class="weight-total"><span>PESO TOTAL</span><span>${quantity(pesoPedidoImpressao(data))} kg</span></div></div>${String(p["observacoes"] ?? "").trim() ? `<section class="order-observations"><strong>Observações do pedido</strong><div>${escapeHtml(p["observacoes"])}</div></section>` : ""}<div class="signature">${orcamento ? "Aceite do cliente" : "Assinatura"}</div><footer>${orcamento ? "Orçamento" : "Pedido"} nº ${escapeHtml(p["numero"])} · ${escapeHtml(c["razao_social"])} — ${orcamento ? "Proposta comercial sujeita à validade e aprovação interna. Não confirma venda nem reserva estoque. Sem valor fiscal." : "Documento de pedido, sem valor fiscal."}</footer></article>`;
    })
    .join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${dados.every((d) => d.pedido["tipo_documento"] === "orcamento") ? "Impressão de orçamentos" : "Impressão de pedidos"}</title><style>${css}</style></head><body>${sheets}</body></html>`;
}
