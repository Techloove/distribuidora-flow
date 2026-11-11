/** Condições padrão de novas emissões, conforme modelo Boleto da API Sicoob v3. */
export const especiesSicoob = [
  "CH",
  "DM",
  "DMI",
  "DS",
  "DSI",
  "DR",
  "LC",
  "NCC",
  "NCE",
  "NCI",
  "NCR",
  "NP",
  "NPR",
  "TM",
  "TS",
  "NS",
  "RC",
  "FAT",
  "ND",
  "AP",
  "ME",
  "PC",
  "NF",
  "DD",
  "BDP",
  "OU",
] as const;
export const padraoEmissaoSicoob = {
  especie: "DM",
  formulario: 1,
  pix: 2,
  multaTipo: 0,
  multaValor: 0,
  multaDias: 1,
  jurosTipo: 3,
  jurosValor: 0,
  jurosDias: 1,
  descontoTipo: 0,
  descontoValor: 0,
  descontoDias: 0,
  protestoTipo: 3,
  protestoDias: 30,
  negativacaoTipo: 3,
  negativacaoDias: 60,
  limiteDias: 0,
  instrucoes: "",
};
export type EmissaoSicoob = typeof padraoEmissaoSicoob;
export function validarEmissaoSicoob(raw: unknown): EmissaoSicoob {
  if (raw == null) return { ...padraoEmissaoSicoob };
  if (typeof raw !== "object" || Array.isArray(raw)) throw Error("Condições de emissão inválidas.");
  const c = { ...padraoEmissaoSicoob, ...raw };
  const opcao = (v: number, op: readonly number[]) => {
    if (!op.includes(v)) throw Error("Tipo de condição Sicoob inválido.");
  };
  const inteiro = (v: number, min: number, max: number) => {
    if (!Number.isInteger(v) || v < min || v > max)
      throw Error(`Prazo Sicoob deve estar entre ${min} e ${max} dias.`);
  };
  const valor = (v: number, percentual: boolean) => {
    if (
      !Number.isFinite(v) ||
      v <= 0 ||
      v > (percentual ? 100 : 999999999.99) ||
      Math.abs(v * 100 - Math.round(v * 100)) > 0.00001
    )
      throw Error("Informe valor positivo com até duas casas decimais; percentual até 100%.");
  };
  if (!(especiesSicoob as readonly string[]).includes(c.especie))
    throw Error("Espécie de documento Sicoob inválida.");
  opcao(c.formulario, [1, 2, 3]);
  opcao(c.pix, [0, 1, 2]);
  opcao(c.multaTipo, [0, 1, 2]);
  opcao(c.jurosTipo, [1, 2, 3]);
  opcao(c.descontoTipo, [0, 1, 2]);
  opcao(c.protestoTipo, [1, 2, 3]);
  opcao(c.negativacaoTipo, [2, 3]);
  inteiro(c.multaDias, 1, 999);
  inteiro(c.jurosDias, 1, 999);
  inteiro(c.descontoDias, 0, 999);
  inteiro(c.limiteDias, 0, 999);
  inteiro(c.protestoDias, 1, 99);
  inteiro(c.negativacaoDias, 1, 99);
  if (c.multaTipo) valor(c.multaValor, c.multaTipo === 2);
  if (c.jurosTipo !== 3) valor(c.jurosValor, c.jurosTipo === 2);
  if (c.descontoTipo) valor(c.descontoValor, c.descontoTipo === 2);
  if (
    c.limiteDias &&
    ((c.multaTipo && c.multaDias > c.limiteDias) ||
      (c.jurosTipo !== 3 && c.jurosDias > c.limiteDias))
  )
    throw Error("O início dos encargos deve respeitar o prazo limite de pagamento.");
  if (
    typeof c.instrucoes !== "string" ||
    c.instrucoes.split("\n").length > 5 ||
    c.instrucoes.split("\n").some((x) => x.length > 40)
  )
    throw Error("Informe até 5 instruções com no máximo 40 caracteres cada.");
  return Object.fromEntries(
    Object.keys(padraoEmissaoSicoob).map((k) => [k, c[k as keyof EmissaoSicoob]]),
  ) as EmissaoSicoob;
}
function deslocar(dia: string, dias: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw Error("Vencimento inválido.");
  const d = new Date(dia + "T12:00:00Z");
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== dia)
    throw Error("Vencimento inválido.");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
export function condicoesEmissaoSicoob(
  raw: unknown,
  vencimento: string,
  valor: number,
  emissao: string,
) {
  deslocar(vencimento, 0);
  const c = validarEmissaoSicoob(raw);
  const b: Record<string, unknown> = {
    codigoEspecieDocumento: c.especie,
    tipoFormularioImpressaoPDF: c.formulario,
    codigoCadastrarPIX: c.pix,
    tipoMulta: c.multaTipo,
    tipoJurosMora: c.jurosTipo,
    tipoDesconto: c.descontoTipo,
    codigoProtesto: c.protestoTipo,
    codigoNegativacao: c.negativacaoTipo,
  };
  if (c.multaTipo)
    Object.assign(b, { dataMulta: deslocar(vencimento, c.multaDias), valorMulta: c.multaValor });
  if (c.jurosTipo !== 3)
    Object.assign(b, {
      dataJurosMora: deslocar(vencimento, c.jurosDias),
      valorJurosMora: c.jurosValor,
    });
  if (c.descontoTipo) {
    const data = deslocar(vencimento, -c.descontoDias);
    if (data < emissao)
      throw Error("O prazo do desconto já passou. Revise as condições antes de emitir.");
    if (
      (c.descontoTipo === 1 && c.descontoValor >= valor) ||
      (c.descontoTipo === 2 && c.descontoValor >= 100)
    )
      throw Error("O desconto deve ser menor que o valor do boleto.");
    Object.assign(b, { dataPrimeiroDesconto: data, valorPrimeiroDesconto: c.descontoValor });
  }
  if (c.protestoTipo !== 3) b["numeroDiasProtesto"] = c.protestoDias;
  if (c.negativacaoTipo !== 3) b["numeroDiasNegativacao"] = c.negativacaoDias;
  if (c.limiteDias) b["dataLimitePagamento"] = deslocar(vencimento, c.limiteDias);
  const linhas = c.instrucoes
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  if (linhas.length) b["mensagensInstrucao"] = linhas;
  return b;
}
