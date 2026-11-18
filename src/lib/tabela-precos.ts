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
  return `${f.nome} · ${numero.format(Number(f.percentual))}%`;
}
/** Separa apenas o nome cadastrado, sem repetir os limites ou a categoria. */
export function linhasFaixaPreco(f: FaixaPeso) {
  const partes = /^(.+?)\s+[-–—]\s+(.+)$/.exec(f.nome.trim());
  return {
    titulo: partes?.[1] ?? f.nome,
    condicao: `${partes?.[2] ? partes[2] + " · " : ""}${numero.format(Number(f.percentual))}%`,
  };
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
const escapar = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export const observacaoTabelaPrecos =
  "Preços unitários de referência sobre o preço normal. Descontos por peso não são cumulativos: dependem da faixa atingida no pedido. Faixas por categoria consideram o peso dos itens dessa categoria. Promoções, condições por cliente, frete e arredondamento do desconto total são conferidos no pedido.";
export type OrientacaoTabelaPrecos = "landscape" | "portrait";
export function htmlTabelaPrecos(
  tabela: TabelaPrecos,
  itens: ItemTabelaPreco[],
  faixas: FaixaPeso[],
  orientacao: OrientacaoTabelaPrecos = "portrait",
) {
  const preco = (v: number | null) => (v === null ? "Não informado" : brl(v));
  const retrato = orientacao === "portrait";
  const pagina = retrato ? "portrait" : "landscape";
  const fonte = retrato
    ? faixas.length > 5
      ? 7
      : faixas.length > 3
        ? 8
        : 10
    : faixas.length > 5
      ? 8
      : faixas.length > 3
        ? 9
        : 11;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Tabela de preços — ${escapar(tabela.loja.nome)}</title>
<style>@page{size:A4 ${pagina};margin:${retrato ? 8 : 12}mm}*{box-sizing:border-box}body{font:${fonte}px Arial,sans-serif;color:#142a38;margin:0}h1{font-size:20px;margin:0 0 8px}p{line-height:1.5}table{width:100%;border-collapse:collapse;margin:12px 0;table-layout:fixed}thead{display:table-header-group}th,td{padding:${retrato ? "5px 3px" : "7px 5px"};border:1px solid #cbd5e1;overflow-wrap:anywhere}th{background:#e8f1f5;text-align:left}tr{break-inside:avoid}td.valor{text-align:right;white-space:${retrato ? "normal" : "nowrap"}}th.produto{width:25%}th.codigo{width:7%}th.unidade{width:4%}th.normal{width:11%}.condicao{display:block;font-weight:normal}.rodape{font-size:10px;color:#415366}</style></head><body>
<section><h1>Tabela de preços · ${escapar(tabela.loja.nome)}</h1><p>Consulta: ${escapar(dataHoraBr(tabela.consultado_em))} · ${itens.length} produto(s)</p>
<table><thead><tr><th class="codigo">Código</th><th class="produto">Produto</th><th class="unidade">Un.</th><th class="normal">Preço normal</th>${faixas
    .map((f) => {
      const linhas = linhasFaixaPreco(f);
      return `<th aria-label="${escapar(descricaoFaixaPreco(f))}"><strong>${escapar(linhas.titulo)}</strong><span class="condicao">${escapar(linhas.condicao)}</span></th>`;
    })
    .join("")}</tr></thead>
<tbody>${itens.map((p) => `<tr><td>${escapar(p.codigo)}</td><td>${escapar(p.descricao)}</td><td>${escapar(p.unidade)}</td><td class="valor">${escapar(preco(p.preco_normal))}</td>${faixas.map((f) => `<td class="valor">${escapar(preco(precoPorFaixa(p.preco_normal, f.percentual)))}</td>`).join("")}</tr>`).join("")}</tbody></table>
<p class="rodape">${escapar(observacaoTabelaPrecos)}</p></section></body></html>`;
}
