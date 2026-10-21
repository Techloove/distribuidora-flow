/** Contrato FAZNOTAS/Myse v3.10.0. Nenhuma função deste módulo emite documentos. */
export const FAZNOTAS_BASE_URL = "https://api.mysebr.com.br/nfemyse-v3/rest";
export const FAZNOTAS_POLL_MIN_MS = 5000;
export const UFS_FISCAIS =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
export type RegraFiscal = {
  uf_emitente: string;
  cfop_interno: string;
  cfop_interestadual: string;
  revisado_contador: boolean;
};
export type ProdutoFiscal = {
  ncm?: string | null;
  cest?: string | null;
  ean?: string | null;
  unidade?: string | null;
  origem_fiscal?: string | null;
  cfop?: string | null;
  cfop_interestadual?: string | null;
};
export function pendenciasProdutoFiscal(p: ProdutoFiscal): string[] {
  const erros: string[] = [];
  if (!/^\d{8}$/.test(p.ncm ?? "")) erros.push("NCM deve conter 8 dígitos");
  if (p.cest && !/^\d{7}$/.test(p.cest)) erros.push("CEST deve conter 7 dígitos");
  if (!/^[0-8]$/.test(p.origem_fiscal ?? "")) erros.push("Informe a origem da mercadoria (0 a 8)");
  if (!p.unidade?.trim()) erros.push("Informe a unidade de venda");
  if (p.ean && p.ean !== "SEM GTIN") {
    const ean = p.ean;
    let soma = 0;
    for (let i = ean.length - 2, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3)
      soma += Number(ean[i]) * peso;
    if (
      !/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(ean) ||
      (10 - (soma % 10)) % 10 !== Number(ean.at(-1))
    )
      erros.push("GTIN / EAN inválido");
  }
  if (p.cfop && !/^5\d{3}$/.test(p.cfop))
    erros.push("CFOP interno deve iniciar com 5 e ter 4 dígitos");
  if (p.cfop_interestadual && !/^6\d{3}$/.test(p.cfop_interestadual))
    erros.push("CFOP interestadual deve iniciar com 6 e ter 4 dígitos");
  return erros;
}
/** UF obtida pela consulta do CEP, nunca inferida pelo prefixo numérico. */
export function selecionarCfop(
  regra: RegraFiscal,
  ufCep: string,
  ufCadastro: string,
  produto?: ProdutoFiscal,
): string {
  if (!regra.revisado_contador)
    throw new Error("Regras fiscais da loja aguardam revisão do contador");
  const destino = ufCep.trim().toUpperCase();
  const origem = regra.uf_emitente.trim().toUpperCase();
  if (!UFS_FISCAIS.includes(destino) || !UFS_FISCAIS.includes(origem))
    throw new Error("UF do emitente ou do CEP inválida");
  if (destino !== ufCadastro.trim().toUpperCase())
    throw new Error("UF do cadastro diverge do CEP. Corrija o endereço do cliente");
  const interno = origem === destino;
  const cfop = interno
    ? produto?.cfop || regra.cfop_interno
    : produto?.cfop_interestadual || regra.cfop_interestadual;
  if (!(interno ? /^5\d{3}$/ : /^6\d{3}$/).test(cfop))
    throw new Error("Configure o CFOP para esta operação");
  return cfop;
}
export type RetornoFaznotas = {
  status?: string;
  data?: { recibo?: string; sefaz?: { codigo?: string | number } };
  meta?: { request_id?: string };
};
export function situacaoFaznotas(
  retorno: RetornoFaznotas,
):
  "autorizada" | "processando" | "cancelada" | "rejeitada" | "consultar_original" | "desconhecida" {
  const s = retorno.status;
  const codigo = String(retorno.data?.sefaz?.codigo ?? "");
  if (s === "004" && ["100", "120", "150"].includes(codigo)) return "autorizada";
  if (["001", "002", "003"].includes(s ?? "") || (s === "900" && ["105", "217"].includes(codigo)))
    return "processando";
  if (s === "050") return "consultar_original";
  if (s === "010") return "cancelada";
  if (s === "400" || s === "900") return "rejeitada";
  return "desconhecida";
}
