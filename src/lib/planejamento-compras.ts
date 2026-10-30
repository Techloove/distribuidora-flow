export type MetodoCompra = "cobertura" | "minimo" | "minmax" | "pendencias";
export type BaseConsumo = "30" | "60" | "90" | "120" | "ponderada";
export type ConfigCompra = {
  metodo: MetodoCompra;
  base: BaseConsumo;
  cobertura: number;
  prazoPadrao: number;
  usarPrazoProduto: boolean;
  seguranca: number;
  ajuste: number;
  multiplo: number;
  loteMinimo: number;
  considerarTransito: boolean;
};
export const CONFIG_COMPRA: ConfigCompra = {
  metodo: "cobertura",
  base: "90",
  cobertura: 30,
  prazoPadrao: 0,
  usarPrazoProduto: true,
  seguranca: 0,
  ajuste: 0,
  multiplo: 0,
  loteMinimo: 0,
  considerarTransito: true,
};
export const METODOS_COMPRA = {
  cobertura: "Cobertura por consumo",
  minimo: "Repor até o mínimo",
  minmax: "Mínimo e máximo",
  pendencias: "Atender pendências",
};
export const BASES_CONSUMO = {
  "30": "Últimos 30 dias",
  "60": "Últimos 60 dias",
  "90": "Últimos 90 dias",
  "120": "Últimos 120 dias",
  ponderada: "Ponderada: 4 meses, peso maior no recente",
};
export type FonteCompra = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const quantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
export const qtdCompra = (v: number) => (Number.isFinite(v) ? quantidade.format(v) : "—");
export function validarConfigCompra(c: ConfigCompra) {
  const erros: string[] = [];
  if (!Object.hasOwn(METODOS_COMPRA, c.metodo) || !Object.hasOwn(BASES_CONSUMO, c.base))
    erros.push("Escolha um método e uma base de consumo válidos.");
  for (const [nome, v, max, inteiro] of [
    ["Cobertura", c.cobertura, 365, true],
    ["Prazo padrão", c.prazoPadrao, 365, true],
    ["Segurança", c.seguranca, 365, true],
    ["Múltiplo", c.multiplo, 1000000, false],
    ["Lote mínimo", c.loteMinimo, 1000000, false],
  ] as const)
    if (!Number.isFinite(v) || v < 0 || v > max || (inteiro && !Number.isInteger(v)))
      erros.push(`${nome}: informe valor entre 0 e ${max}${inteiro ? ", em dias inteiros" : ""}.`);
  if (!Number.isFinite(c.ajuste) || c.ajuste < -90 || c.ajuste > 300)
    erros.push("Ajuste de demanda: use percentual entre -90 e 300.");
  if ([c.multiplo, c.loteMinimo].some((v) => Math.abs(v * 1000 - Math.round(v * 1000)) > 1e-7))
    erros.push("Lotes e múltiplos aceitam até três casas decimais.");
  return erros;
}
export function calcularCompra(r: FonteCompra, c: ConfigCompra) {
  const estoque = num(r["estoque_atual"]),
    minimo = Math.max(num(r["estoque_minimo"]), 0),
    maximo = Math.max(num(r["estoque_maximo"]), 0);
  const pendencia = num(r["pendencia_aprovada"]);
  const transito = c.considerarTransito ? num(r["em_transito"]) : 0;
  const vendas = [30, 60, 90, 120].map((n) => num(r[`venda_${n}`]));
  const erros = validarConfigCompra(c);
  if (
    [estoque, minimo, maximo, pendencia, transito, ...vendas, num(r["prazo_fornecedor_dias"])].some(
      (v) => !Number.isFinite(v),
    )
  )
    erros.push("Há valores inválidos nos dados do produto.");
  if (vendas.some((v, i) => v < 0 || (i > 0 && v < vendas[i - 1]!)))
    erros.push("Histórico de vendas inconsistente. Confira a origem dos dados.");
  if (
    [
      num(r["estoque_minimo"]),
      num(r["estoque_maximo"]),
      pendencia,
      num(r["em_transito"]),
      num(r["prazo_fornecedor_dias"]),
    ].some((v) => v < 0)
  )
    erros.push("Mínimo, máximo, pendências, trânsito e prazo não podem ser negativos.");
  const prazo = c.usarPrazoProduto
    ? Math.max(num(r["prazo_fornecedor_dias"]) || c.prazoPadrao, 0)
    : c.prazoPadrao;
  const baseDiaria =
    c.base === "ponderada"
      ? (vendas[0]! * 4 +
          (vendas[1]! - vendas[0]!) * 3 +
          (vendas[2]! - vendas[1]!) * 2 +
          (vendas[3]! - vendas[2]!)) /
        300
      : num(r[`venda_${c.base}`]) / Number(c.base);
  const diario = baseDiaria * (1 + c.ajuste / 100),
    mediaMes = diario * 30,
    disponivel = estoque - pendencia,
    posicao = disponivel + transito;
  const ponto = Math.max(minimo, diario * (prazo + c.seguranca));
  let alvo = 0;
  if (c.metodo === "cobertura") alvo = minimo + diario * (c.cobertura + prazo + c.seguranca);
  else if (c.metodo === "minimo") alvo = minimo;
  else if (c.metodo === "minmax") {
    if (maximo <= 0 || maximo < minimo)
      erros.push("Cadastre um estoque máximo positivo e maior ou igual ao mínimo.");
    alvo = posicao <= ponto ? maximo : posicao;
  }
  const necessidade = Math.max(alvo - posicao, 0);
  const fracionada = /^(KG|G|L|LT|ML|M|MT|M2|M²|M3|M³|TON|T)$/i.test(
    String(r["unidade"] ?? "").trim(),
  );
  const multiplo = c.multiplo > 0 ? c.multiplo : fracionada ? 0.001 : 1;
  const sugestao = erros.length
    ? 0
    : necessidade > 1e-9
      ? Math.round(
          Math.ceil(Math.max(necessidade, c.loteMinimo) / multiplo - 1e-9) * multiplo * 1000,
        ) / 1000
      : 0;
  const custoBruto = r["custo_referencia"] == null ? null : num(r["custo_referencia"]);
  const custo =
    custoBruto !== null && Number.isFinite(custoBruto) && custoBruto > 0 ? custoBruto : null;
  const investimento =
    custo !== null && Number.isFinite(custo) && custo > 0
      ? Math.round(sugestao * custo * 100) / 100
      : null;
  const cobertura = diario > 0 && Number.isFinite(diario) ? Math.max(disponivel, 0) / diario : null;
  const status = erros.length
    ? "Revisar parâmetros"
    : disponivel < 0
      ? "Ruptura"
      : sugestao > 0
        ? "Comprar"
        : transito > 0 && disponivel <= ponto
          ? "Aguardar trânsito"
          : diario === 0 && estoque > 0
            ? "Sem giro"
            : "Abastecido";
  const avisos: string[] = [];
  if (
    num(r["dias_historico"]) > 0 &&
    num(r["dias_historico"]) < (c.base === "ponderada" ? 120 : Number(c.base))
  )
    avisos.push(
      "Histórico recente: a média usa a janela completa, sem extrapolar poucos dias de vendas.",
    );
  if (diario === 0)
    avisos.push("Sem vendas líquidas na base escolhida; a projeção não estima demanda futura.");
  if (custo === null || custo <= 0)
    avisos.push("Sem custo de referência: investimento não estimado.");
  if (maximo > 0 && alvo > maximo && c.metodo === "cobertura")
    avisos.push(
      "O alvo calculado supera o máximo cadastrado. Revise a cobertura antes de comprar.",
    );
  if (c.metodo === "minmax" && maximo > 0 && maximo < ponto)
    avisos.push("O máximo cadastrado está abaixo do ponto de reposição calculado.");
  if (c.considerarTransito && transito > 0)
    avisos.push(
      "Compras em trânsito reduzem a sugestão, mas a data de chegada precisa ser conferida com o fornecedor.",
    );
  return {
    estoque,
    minimo,
    maximo,
    pendencia,
    transito,
    prazo,
    diario,
    mediaMes,
    disponivel,
    posicao,
    ponto,
    alvo,
    necessidade,
    multiplo,
    sugestao,
    custo,
    investimento,
    cobertura,
    status,
    avisos,
    erros,
  };
}
export type CalculoCompra = ReturnType<typeof calcularCompra>;
