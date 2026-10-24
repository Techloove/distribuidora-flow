/** Validações fiscais locais, independentes do provedor de emissão. */
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
export function validarConfiguracaoFiscal(
  config: RegraFiscal & { serie: string; regime: string },
): string[] {
  const erros: string[] = [];
  if (!/^[1-9][0-9]{0,2}$/.test(config.serie.trim()))
    erros.push("Informe uma série NF-e de 1 a 999, sem zeros à esquerda.");
  if (!UFS_FISCAIS.includes(config.uf_emitente)) erros.push("Selecione a UF do emitente.");
  if (!["1", "2", "3", "4"].includes(config.regime))
    erros.push("Selecione o regime tributário (CRT).");
  if (!/^5[0-9]{3}$/.test(config.cfop_interno.trim()))
    erros.push("Informe o CFOP de venda dentro da UF: 4 dígitos, começando com 5.");
  if (!/^6[0-9]{3}$/.test(config.cfop_interestadual.trim()))
    erros.push("Informe o CFOP de venda para outra UF: 4 dígitos, começando com 6.");
  return erros;
}
