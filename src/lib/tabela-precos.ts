import { brl, dataHoraBr } from "./formatacao";
import type { FaixaPeso } from "./progresso-desconto-peso";
export type ItemTabelaPreco = {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  categoria: string | null;
  peso_kg: number | null;
  preco_normal: number | null;
};
export type TabelaPrecos = {
  loja: { id: string; nome: string };
  consultado_em: string;
  faixas: FaixaPeso[];
  itens: ItemTabelaPreco[];
};
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
export function descricaoFaixaPreco(f: FaixaPeso) {
  return `${f.nome} · ${numero.format(Number(f.percentual))}% · ${numero.format(Number(f.peso_min))} kg${f.peso_max === null ? " ou mais" : ` a ${numero.format(Number(f.peso_max))} kg`}${f.categoria ? ` · peso da categoria ${f.categoria}` : " · peso total do pedido"}`;
}
/** Projeção unitária sobre preço normal; o pedido arredonda o desconto no total. */
export function precoPorFaixa(preco: number | null, percentual: number): number | null {
  if (
    preco === null ||
    !Number.isFinite(Number(preco)) ||
    Number(preco) < 0 ||
    !Number.isFinite(Number(percentual)) ||
    Number(percentual) < 0 ||
    Number(percentual) > 100
  )
    return null;
  return (
    Math.round((Number(preco) * (1 - Number(percentual) / 100) + Number.EPSILON) * 10000) / 10000
  );
}
export function blocosFaixasPreco(faixas: FaixaPeso[], tamanho = 3): FaixaPeso[][] {
  if (!Number.isInteger(tamanho) || tamanho < 1) throw Error("Tamanho de bloco inválido");
  if (!faixas.length) return [[]];
  return Array.from({ length: Math.ceil(faixas.length / tamanho) }, (_, i) =>
    faixas.slice(i * tamanho, (i + 1) * tamanho),
  );
}
const escapar = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export const observacaoTabelaPrecos =
  "Preços unitários de referência sobre o preço normal. Descontos por peso não são cumulativos: dependem da faixa atingida no pedido. Faixas por categoria consideram o peso dos itens dessa categoria. Promoções, condições por cliente, frete e arredondamento do desconto total são conferidos no pedido.";
export function htmlTabelaPrecos(
  tabela: TabelaPrecos,
  itens: ItemTabelaPreco[],
  faixas: FaixaPeso[],
) {
  const preco = (v: number | null) => (v === null ? "Não informado" : brl(v));
  const blocos = blocosFaixasPreco(faixas);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Tabela de preços — ${escapar(tabela.loja.nome)}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#142a38;margin:0}h1{font-size:20px;margin:0 0 8px}p{line-height:1.5}.bloco+.bloco{break-before:page}table{width:100%;border-collapse:collapse;margin:12px 0;table-layout:fixed}thead{display:table-header-group}th,td{padding:7px 6px;border:1px solid #cbd5e1;overflow-wrap:anywhere}th{background:#e8f1f5;text-align:left}tr{break-inside:avoid}td.valor{text-align:right;white-space:nowrap}th.produto{width:30%}th.codigo{width:9%}th.unidade{width:6%}small{display:block;font-weight:normal;line-height:1.5}.rodape{font-size:10px;color:#415366}</style></head><body>${blocos.map((bloco, i) => `<section class="bloco"><h1>Tabela de preços · ${escapar(tabela.loja.nome)}</h1><p>Consulta: ${escapar(dataHoraBr(tabela.consultado_em))} · ${itens.length} produto(s)${blocos.length > 1 ? ` · Condições ${i + 1} de ${blocos.length}` : ""}</p><table><thead><tr><th class="codigo">Código</th><th class="produto">Produto</th><th class="unidade">Un.</th><th>Preço normal</th>${bloco.map((f) => `<th>${escapar(descricaoFaixaPreco(f))}</th>`).join("")}</tr></thead><tbody>${itens.map((p) => `<tr><td>${escapar(p.codigo)}</td><td>${escapar(p.descricao)}</td><td>${escapar(p.unidade)}</td><td class="valor">${escapar(preco(p.preco_normal))}</td>${bloco.map((f) => `<td class="valor">${escapar(preco(precoPorFaixa(p.preco_normal, f.percentual)))}</td>`).join("")}</tr>`).join("")}</tbody></table><p class="rodape">${escapar(observacaoTabelaPrecos)}</p></section>`).join("")}</body></html>`;
}
