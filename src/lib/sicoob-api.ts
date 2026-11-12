/** Contrato de Cobrança Bancária Sicoob v3. Endereços fixos, sem URLs vindas do navegador. */
export const SICOOB_BASE = "https://api.sicoob.com.br/cobranca-bancaria/v3";
export const SICOOB_SANDBOX = "https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3";
export const SICOOB_AUTH =
  "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token";
// Escopos da Cobrança Bancária v3; webhooks não são usados nesta integração.
export const SICOOB_SCOPES = ["boletos_inclusao", "boletos_consulta", "boletos_alteracao"].join(
  " ",
);
export type SicoobConfig = {
  ambiente: "producao" | "homologacao";
  centro_id: string;
  client_id: string;
  numero_cliente: number;
  numero_conta: number;
  numero_contrato: number | null;
  ativo: boolean;
  versao: number;
  condicoes_emissao?: import("./sicoob-emissao").EmissaoSicoob;
  certificado_configurado: boolean;
  autenticado_em: string | null;
};
export type CondicoesSicoob = {
  nossoNumero: string;
  numeroCliente: number;
  codigoModalidade: number;
  seuNumero: string;
  valor: number;
  vencimento: string;
  abatimento: number;
  tipoDesconto: number;
  descontos: { ordem: number; valor: number; data: string }[];
  situacao: "EM ABERTO" | "BAIXADO" | "LIQUIDADO";
  linhaDigitavel: string;
  codigoBarras: string;
};
export type InstrucaoSicoob = {
  tipo: "vencimento" | "baixar" | "abatimento" | "desconto";
  valor?: number;
  data?: string;
  percentual?: boolean;
  ordem?: number;
};
export function dinheiroSicoob(v: unknown) {
  const s = String(v ?? "");
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(s) ||
    !Number.isFinite(Number(s)) ||
    Number(s) > 999999999999.99
  )
    throw Error("Valor bancário inválido ou sem precisão de centavos.");
  return Number(s);
}
export function dataSicoob(v: unknown) {
  const s = String(v ?? "").slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    throw Error("Data bancária inválida.");
  return s;
}
export function linhaDigitavelSicoob(value: unknown) {
  const linha = String(value ?? "").replace(/[ .\-\s]/g, "");
  if (!/^756[0-9]{44}$/.test(linha))
    throw Error("Informe a linha digitável Sicoob com 47 dígitos, iniciada por 756.");
  return linha;
}

/** A lista por pagador filtra vencimentos, não datas de emissão. */
export function periodoRecuperacaoSicoob(vencimentoOriginal: unknown) {
  const vencimento = dataSicoob(vencimentoOriginal);
  const deslocar = (dias: number) => {
    const data = new Date(vencimento + "T00:00:00.000Z");
    data.setUTCDate(data.getUTCDate() + dias);
    return data.toISOString().slice(0, 10);
  };
  // Duas janelas sem sobreposição; cada uma tem no máximo 31 dias inclusivos.
  return [
    { dataInicio: deslocar(-30), dataFim: vencimento },
    { dataInicio: deslocar(1), dataFim: deslocar(30) },
  ];
}
export function condicoesSicoob(raw: Record<string, unknown>): CondicoesSicoob {
  const situacao = String(raw["situacaoBoleto"] ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (!["EM ABERTO", "BAIXADO", "LIQUIDADO"].includes(situacao))
    throw Error(
      `Situação Sicoob não reconhecida${/^[A-Z0-9 À-Ü_/-]{1,50}$/.test(situacao) ? ` (${situacao})` : situacao === "" ? " (não informada pelo banco)" : ""}. Confira o retorno antes de prosseguir.`,
    );
  const tipo = Number(raw["tipoDesconto"]);
  if (!Number.isInteger(tipo) || tipo < 0 || tipo > 6)
    throw Error("Tipo de desconto Sicoob ausente ou inválido.");
  const descontos: CondicoesSicoob["descontos"] = [];
  for (const [i, n] of ["Primeiro", "Segundo", "Terceiro"].entries()) {
    const valor = raw[`valor${n}Desconto`],
      dia = raw[`data${n}Desconto`];
    if (valor !== undefined && valor !== null && Number(valor) > 0)
      descontos.push({ ordem: i + 1, valor: dinheiroSicoob(valor), data: dataSicoob(dia) });
  }
  if (tipo !== 0 && !descontos.length)
    throw Error("Banco não informou os descontos vigentes. Consulte antes de alterar.");
  const nossoNumero = String(raw["nossoNumero"] ?? "");
  if (
    !/^\d{1,18}$/.test(nossoNumero) ||
    Number(raw["codigoModalidade"]) !== 1 ||
    !Number.isSafeInteger(Number(raw["numeroCliente"])) ||
    Number(raw["numeroCliente"]) <= 0
  )
    throw Error("Identificação bancária inválida.");
  return {
    nossoNumero,
    numeroCliente: Number(raw["numeroCliente"]),
    codigoModalidade: 1,
    seuNumero: String(raw["seuNumero"] ?? ""),
    valor: dinheiroSicoob(raw["valor"]),
    vencimento: dataSicoob(raw["dataVencimento"]),
    abatimento: dinheiroSicoob(raw["valorAbatimento"]),
    tipoDesconto: tipo,
    descontos,
    situacao: situacao as CondicoesSicoob["situacao"],
    linhaDigitavel: String(raw["linhaDigitavel"] ?? "").replace(/\D/g, ""),
    codigoBarras: String(raw["codigoBarras"] ?? "").replace(/\D/g, ""),
  };
}
export function instrucaoSicoob(
  c: CondicoesSicoob,
  i: InstrucaoSicoob,
  hoje: string,
  contrato: number | null,
) {
  if (c.situacao !== "EM ABERTO") throw Error("Somente boletos em aberto podem ser alterados.");
  const body: Record<string, unknown> = {
    numeroCliente: c.numeroCliente,
    codigoModalidade: 1,
    ...(contrato ? { numeroContratoCobranca: contrato } : {}),
  };
  const esperado: CondicoesSicoob = structuredClone(c);
  if (i.tipo === "vencimento") {
    const dia = dataSicoob(i.data);
    if (dia < hoje || dia === c.vencimento)
      throw Error("Informe um novo vencimento a partir de hoje.");
    body["prorrogacaoVencimento"] = { dataVencimento: dia };
    esperado.vencimento = dia;
  } else if (i.tipo === "baixar") {
    esperado.situacao = "BAIXADO";
    delete body["numeroContratoCobranca"];
  } else if (i.tipo === "abatimento") {
    const n = dinheiroSicoob(i.valor);
    if (n >= c.valor || n === c.abatimento)
      throw Error(
        "Informe um abatimento diferente do atual e menor que o valor nominal. Use zero para cancelar.",
      );
    if (n > 0 && c.tipoDesconto > 2)
      throw Error(
        "Desconto por antecipação exige conferência com o banco antes de conceder abatimento.",
      );
    const maiorDesconto = Math.max(
      0,
      ...c.descontos.map((d) => (c.tipoDesconto === 2 ? (c.valor * d.valor) / 100 : d.valor)),
    );
    if (n + maiorDesconto >= c.valor)
      throw Error("Abatimento e desconto devem ser menores que o valor nominal.");
    body["abatimento"] = { valorAbatimento: n };
    esperado.abatimento = n;
  } else if (i.tipo === "desconto") {
    const ordem = i.ordem ?? 1;
    if (![1, 2, 3].includes(ordem)) throw Error("Ordem de desconto inválida.");
    if (![0, 1, 2].includes(c.tipoDesconto))
      throw Error(
        "Este boleto tem desconto por antecipação. A alteração exige conferência pelo banco.",
      );
    const n = dinheiroSicoob(i.valor),
      tipo = n === 0 ? 0 : i.percentual ? 2 : 1;
    if (
      (tipo === 2 && (n >= 100 || (n * c.valor) / 100 + c.abatimento >= c.valor)) ||
      (tipo === 1 && n + c.abatimento >= c.valor)
    )
      throw Error("Desconto deve ser menor que o valor a pagar.");
    if (n === 0) {
      esperado.descontos = [];
      esperado.tipoDesconto = 0;
      body["desconto"] = { tipoDesconto: 0 };
    } else {
      const dia = dataSicoob(i.data);
      if (dia < hoje || dia > c.vencimento)
        throw Error("O prazo de desconto deve ficar entre hoje e o vencimento.");
      if (c.descontos.length > 0 && tipo !== c.tipoDesconto)
        throw Error("Mantenha o tipo de desconto existente ou cancele-o antes de trocar.");
      const ds = c.descontos
        .filter((d) => d.ordem !== ordem)
        .concat({ ordem, valor: n, data: dia })
        .sort((a, b) => a.ordem - b.ordem);
      if (
        ds.some((d, k) => d.ordem !== k + 1) ||
        ds.some((d, k) => k > 0 && (d.data <= ds[k - 1]!.data || d.valor >= ds[k - 1]!.valor))
      )
        throw Error(
          "Descontos devem ter ordens contínuas, datas crescentes e valores decrescentes.",
        );
      const desconto: Record<string, unknown> = { tipoDesconto: tipo };
      for (const d of ds) {
        const nome = ["Primeiro", "Segundo", "Terceiro"][d.ordem - 1]!;
        desconto[`data${nome}Desconto`] = d.data;
        desconto[`valor${nome}Desconto`] = d.valor;
      }
      body["desconto"] = desconto;
      esperado.tipoDesconto = tipo;
      esperado.descontos = ds;
    }
  } else throw Error("Operação Sicoob inválida.");
  if (
    i.tipo === "desconto" &&
    esperado.tipoDesconto === c.tipoDesconto &&
    JSON.stringify(esperado.descontos) === JSON.stringify(c.descontos)
  )
    throw Error("As condições solicitadas já estão vigentes no banco.");
  return { body, esperado };
}
export function confereSicoob(
  atual: CondicoesSicoob,
  esperado: CondicoesSicoob,
  tipo: InstrucaoSicoob["tipo"],
) {
  if (
    atual.nossoNumero !== esperado.nossoNumero ||
    atual.numeroCliente !== esperado.numeroCliente ||
    atual.seuNumero !== esperado.seuNumero ||
    atual.valor !== esperado.valor
  )
    return false;
  if (tipo === "baixar") return atual.situacao === "BAIXADO";
  if (atual.situacao !== "EM ABERTO") return false;
  return tipo === "vencimento"
    ? atual.vencimento === esperado.vencimento
    : tipo === "abatimento"
      ? atual.abatimento === esperado.abatimento
      : atual.tipoDesconto === esperado.tipoDesconto &&
        JSON.stringify(atual.descontos) === JSON.stringify(esperado.descontos);
}

/** Sentinela observada no mock oficial; nunca é um identificador operacional. */
export function respostaSimuladaSicoob(raw: Record<string, unknown>) {
  return (
    raw["nossoNumero"] === -2147483648 &&
    raw["codigoModalidade"] === 1 &&
    typeof raw["numeroCliente"] === "number" &&
    Number.isSafeInteger(raw["numeroCliente"]) &&
    raw["numeroCliente"] > 0 &&
    typeof raw["valor"] === "number" &&
    Number.isFinite(raw["valor"]) &&
    raw["valor"] >= 0
  );
}

/** Só nomes fixos dos campos: permite diagnosticar sem expor dados do pagador ou credenciais. */
export function camposDivergentesBoletoSicoob(
  c: CondicoesSicoob,
  b: Record<string, unknown>,
  cfg: Pick<SicoobConfig, "numero_cliente" | "numero_conta">,
  raw: Record<string, unknown>,
): string[] {
  const campos: string[] = [];
  if (c.numeroCliente !== cfg.numero_cliente) campos.push("beneficiário (numeroCliente)");
  if (c.codigoModalidade !== 1) campos.push("modalidade");
  if (c.seuNumero !== String(b["seu_numero"])) campos.push("identificador do título (seuNumero)");
  if (c.valor !== Number(b["valor"])) campos.push("valor nominal");
  if (b["nosso_numero"] && c.nossoNumero !== String(b["nosso_numero"])) campos.push("nosso número");
  if (
    raw["numeroContaCorrente"] !== undefined &&
    Number(raw["numeroContaCorrente"]) !== cfg.numero_conta
  )
    campos.push("conta corrente");
  return campos;
}
