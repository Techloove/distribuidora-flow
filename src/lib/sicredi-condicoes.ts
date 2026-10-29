/** Manual API Cobrança Sicredi 4.0: §§7.6,7.7,7.10,7.11 e consulta §7.18. */
export type CondicoesSicredi = {
  nominal: number;
  abatimento: number;
  tipoDesconto: "VALOR" | "PERCENTUAL" | "SEM_DESCONTO";
  descontos: { ordem: number; valor: number; data: string }[];
  vencimento: string;
  situacao: string;
};
export type InstrucaoSicredi = {
  tipo: "abatimento" | "cancelar_abatimento" | "desconto" | "data_desconto";
  valor?: number;
  ordem?: number;
  data?: string;
};
function dinheiro(v: unknown): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(v)))
    throw new Error("Valor bancário ausente ou inválido. Concilie antes de alterar.");
  const n = Number(v);
  if (!Number.isFinite(n) || n > 999999999999.99) throw new Error("Valor fora do limite.");
  return n;
}
function dataISO(v: unknown): string {
  const s = String(v ?? "");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    throw new Error("Data bancária inválida.");
  return s;
}
export function condicoesSicredi(json: Record<string, unknown>): CondicoesSicredi {
  const raw = String(json["tipoDesconto"] ?? "").toUpperCase();
  const tipoDesconto = ["VALOR", "A - VALOR"].includes(raw)
    ? "VALOR"
    : ["PERCENTUAL", "B - PERCENTUAL"].includes(raw)
      ? "PERCENTUAL"
      : "SEM_DESCONTO";
  if (!Array.isArray(json["descontos"]))
    throw new Error("Sicredi não informou as condições de desconto.");
  const descontos = json["descontos"]
    .map((x: Record<string, unknown>) => {
      const ordem = Number(x["numeroOrdem"]);
      if (![1, 2, 3].includes(ordem)) throw new Error("Ordem de desconto inválida.");
      return { ordem, valor: dinheiro(x["valorDesconto"]), data: dataISO(x["dataLimite"]) };
    })
    .sort((a, b) => a.ordem - b.ordem);
  if (
    descontos.length > 3 ||
    new Set(descontos.map((x) => x.ordem)).size !== descontos.length ||
    (descontos.length && tipoDesconto === "SEM_DESCONTO")
  )
    throw new Error("Condições de desconto inconsistentes.");
  return {
    nominal: dinheiro(json["valorNominal"]),
    abatimento: dinheiro(json["abatimento"]),
    tipoDesconto,
    descontos,
    vencimento: dataISO(json["dataVencimento"]),
    situacao: String(json["situacao"] ?? json["situacaoBoleto"] ?? "")
      .trim()
      .toUpperCase(),
  };
}
export function instrucaoSicredi(c: CondicoesSicredi, i: InstrucaoSicredi, hoje: string) {
  if (!["EM CARTEIRA", "VENCIDO"].includes(c.situacao))
    throw new Error("Somente boleto normal em carteira ou vencido permite esta alteração.");
  const esperado: CondicoesSicredi = structuredClone(c);
  let endpoint: string, body: Record<string, unknown>;
  const valor = i.valor === undefined ? 0 : dinheiro(i.valor);
  if (i.tipo === "abatimento") {
    if (c.abatimento > 0)
      throw new Error(
        "Já existe abatimento. Cancele-o e confira no banco antes de conceder outro.",
      );
    if (valor <= 0 || valor >= c.nominal)
      throw new Error("Informe abatimento maior que zero e menor que o valor nominal.");
    esperado.abatimento = valor;
    endpoint = "conceder-abatimento";
    body = { valorAbatimento: valor.toFixed(2) };
  } else if (i.tipo === "cancelar_abatimento") {
    if (c.abatimento <= 0) throw new Error("Não há abatimento concedido para cancelar.");
    esperado.abatimento = 0;
    endpoint = "cancelar-abatimento";
    body = {};
  } else if (i.tipo === "desconto" || i.tipo === "data_desconto") {
    const desconto = esperado.descontos.find((x) => x.ordem === i.ordem);
    if (!desconto)
      throw new Error(
        "Esta instrução altera somente um desconto já cadastrado no Sicredi. Para redução sem prazo, use abatimento.",
      );
    if (i.tipo === "desconto") {
      if (valor <= 0 || (c.tipoDesconto === "PERCENTUAL" ? valor >= 100 : valor >= c.nominal))
        throw new Error("Valor ou percentual de desconto inválido.");
      desconto.valor = valor;
      endpoint = "desconto";
      body = { [`valorDesconto${i.ordem}`]: valor };
    } else {
      const data = dataISO(i.data);
      if (data < hoje || data > c.vencimento)
        throw new Error("A data do desconto deve ficar entre hoje e o vencimento.");
      desconto.data = data;
      endpoint = "data-desconto";
      body = { [`data${i.ordem}`]: data };
    }
  } else throw new Error("Instrução não suportada.");
  if (new Set(esperado.descontos.map((d) => d.data)).size !== esperado.descontos.length)
    throw new Error("Os descontos precisam ter datas diferentes.");
  for (const d of esperado.descontos) {
    const v = esperado.tipoDesconto === "PERCENTUAL" ? (c.nominal * d.valor) / 100 : d.valor;
    if (v + esperado.abatimento >= c.nominal)
      throw new Error("Desconto e abatimento não podem consumir todo o valor do boleto.");
  }
  if (JSON.stringify(esperado) === JSON.stringify(c))
    throw new Error("Informe uma condição diferente da atual.");
  return { endpoint, body, esperado };
}
export function condicoesCorrespondem(a: CondicoesSicredi, b: CondicoesSicredi) {
  return (
    a.nominal === b.nominal &&
    a.abatimento === b.abatimento &&
    a.tipoDesconto === b.tipoDesconto &&
    a.vencimento === b.vencimento &&
    JSON.stringify(a.descontos) === JSON.stringify(b.descontos)
  );
}

export type HistoricoCondicoesSicredi = {
  id: string;
  tipo: InstrucaoSicredi["tipo"];
  motivo: string;
  estado: string;
  anterior: CondicoesSicredi;
  esperado: CondicoesSicredi;
  created_at: string;
};
