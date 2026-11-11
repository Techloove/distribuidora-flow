/** Extrato Sicoob: leitura para conferência, sem produzir lançamentos financeiros. */
export const SICOOB_CONTA_BASE = "https://api.sicoob.com.br/conta-corrente/v4";
export const SICOOB_CONTA_SCOPES = "cco_consulta openid";
export function consultaExtratoSicoob(
  conta: string,
  mes: string,
  inicial: number,
  final: number,
  hoje: string,
) {
  if (!/^\d{1,18}$/.test(conta) || !Number.isSafeInteger(Number(conta)) || Number(conta) <= 0)
    throw Error("Informe o número completo da conta, somente números.");
  if (!/^\d{4}-\d{2}$/.test(mes) || !/^\d{4}-\d{2}-\d{2}$/.test(hoje))
    throw Error("Competência inválida.");
  const [ano, m] = mes.split("-").map(Number) as [number, number];
  const [aHoje, mHoje] = hoje.split("-").map(Number) as [number, number];
  const distancia = aHoje * 12 + mHoje - (ano * 12 + m);
  if (m < 1 || m > 12 || distancia < 0 || distancia > 3)
    throw Error("Consulte o mês atual ou até três meses anteriores.");
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  if (
    !Number.isInteger(inicial) ||
    !Number.isInteger(final) ||
    inicial < 1 ||
    final < inicial ||
    final > ultimo ||
    (mes === hoje.slice(0, 7) && final > Number(hoje.slice(8, 10)))
  )
    throw Error("Informe um intervalo de dias válido, sem datas futuras.");
  return `/extrato/${m}/${ano}?${new URLSearchParams({ diaInicial: String(inicial), diaFinal: String(final), agruparCNAB: "false", numeroContaCorrente: conta })}`;
}
function texto(x: unknown, max = 350) {
  return typeof x === "string" || typeof x === "number" ? String(x).slice(0, max) : "";
}
export function valorExtratoSicoob(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (/^-?\d+(?:\.\d{1,2})?$/.test(s)) return Number(s);
  if (/^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(s))
    return Number(s.replace(/\./g, "").replace(",", "."));
  return null;
}
export function extratoParaConferenciaSicoob(raw: unknown) {
  const objeto = (x: unknown): x is Record<string, unknown> =>
    !!x && typeof x === "object" && !Array.isArray(x);
  const raiz = objeto(raw) ? raw : {};
  const corpo = Object.hasOwn(raiz, "transacoes")
    ? raiz
    : objeto(raiz["resultado"])
      ? raiz["resultado"]
      : raiz;
  const transacoes = corpo["transacoes"];
  if (!Array.isArray(transacoes)) {
    // Somente nomes técnicos, nunca valores, saldos, documentos ou credenciais.
    const campos = (x: Record<string, unknown>) =>
      Object.keys(x)
        .filter((k) => /^[a-zA-Z_][a-zA-Z_]{0,39}$/.test(k))
        .slice(0, 12)
        .join(", ") || "nenhum";
    throw Error(
      `O Sicoob respondeu, mas não trouxe a lista de transações no formato esperado. Campos recebidos: ${campos(raiz)}${corpo !== raiz ? `; resultado: ${campos(corpo)}` : ""}. Isso não confirma ausência de movimentos.`,
    );
  }
  if (transacoes.length > 10000)
    throw Error("O extrato ultrapassou 10.000 movimentos. Consulte um período menor.");
  return transacoes.map((r: unknown) => {
    if (!r || typeof r !== "object" || Array.isArray(r))
      throw Error("Transação de extrato inválida.");
    const x = r as Record<string, unknown>;
    const descritivo = texto(x["descricao"]);
    return {
      id: texto(x["transactionId"], 120),
      tipo: texto(x["tipo"], 40),
      valor: valorExtratoSicoob(x["valor"]),
      valorOriginal: texto(x["valor"], 60),
      data: texto(x["data"], 60),
      dataLote: texto(x["dataLote"], 60),
      descricao: descritivo,
      documento: texto(x["numeroDocumento"], 100),
      complemento: texto(x["descInfComplementar"]),
      possivelTarifa: /tarifa|\btar\.|taxa/i.test(descritivo),
    };
  });
}
