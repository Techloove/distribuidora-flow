import { extratoParaConferenciaSicoob } from "./sicoob-extrato";

/** Documento isolado do extrato não é evidência de vínculo com boleto. */
export function referenciaBoletoSicoob(
  descricao: string,
  complemento: string,
  explicito?: unknown,
) {
  if (
    (typeof explicito === "string" || typeof explicito === "number") &&
    /^\d{1,18}$/.test(String(explicito)) &&
    (typeof explicito !== "number" || Number.isSafeInteger(explicito))
  )
    return String(explicito);
  const s = (descricao + " " + complemento)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const refs = [...s.matchAll(/\bNOSSO\s*(?:NUMERO|N[º°.]?)\s*[:=#-]?\s*(\d{1,18})(?!\d)/g)].map(
    (x) => x[1]!,
  );
  return new Set(refs).size === 1 ? refs[0]! : "";
}
export function movimentosTarifasSicoob(raw: Record<string, unknown>) {
  const safe = extratoParaConferenciaSicoob(raw);
  const root = Array.isArray(raw["transacoes"])
    ? raw
    : (raw["resultado"] as Record<string, unknown>);
  const originais = root["transacoes"] as Record<string, unknown>[];
  return safe.map((x, i) => {
    let dia = x.data;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dia)) dia = dia.split("/").reverse().join("-");
    else if (/^\d{4}-\d{2}-\d{2}T/.test(dia)) {
      const d = new Date(dia);
      dia = Number.isFinite(d.getTime())
        ? new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Sao_Paulo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(d)
        : "";
    }
    const d = new Date(dia + "T12:00:00Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dia) ||
      !Number.isFinite(d.getTime()) ||
      d.toISOString().slice(0, 10) !== dia
    )
      dia = "";
    return {
      id: x.id.trim(),
      tipo: x.tipo
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .trim(),
      valor: x.valor,
      data: dia,
      descricao: x.descricao,
      documento: x.documento,
      nosso_numero: referenciaBoletoSicoob(
        x.descricao,
        x.complemento,
        originais[i]?.["nossoNumero"],
      ),
    };
  });
}

type RowTarifa = Record<string, unknown>;
/** Não soma ao LIQUI um débito genérico do extrato que pode representar a mesma tarifa. */
export function resumoTarifasSicoob(rows: RowTarifa[], tarifaLiqui: number | null) {
  const liqui = rows.filter((r) => r["fonte_361"] === "liqui");
  const elegiveis = rows.filter(
    (r) =>
      r["fonte_361"] === "liqui" ||
      r["natureza_361"] === "outra" ||
      (liqui.length === 0 && tarifaLiqui === null),
  );
  const extrato = elegiveis.filter((r) => r["fonte_361"] !== "liqui");
  const valorLiqui = tarifaLiqui ?? (liqui.length ? Number(liqui[0]!["valor"]) : null);
  const total = extrato.reduce((v, r) => v + Math.round(Number(r["valor"]) * 100), 0);
  const confereMovimento = (r: RowTarifa) => {
    const m = r["movimento"] as RowTarifa | null;
    return (
      r["estado"] === "lancado" &&
      !!r["movimento_id"] &&
      m?.["status"] === "ativo" &&
      m["tipo"] === "saida" &&
      Number(m["valor"]) === Number(r["valor"]) &&
      m["conta_id"] === r["conta_id"] &&
      m["categoria_id"] === r["categoria_id"] &&
      m["data"] === r["data_lancamento"]
    );
  };
  const liquidacaoContabilizada =
    valorLiqui === null ||
    valorLiqui === 0 ||
    liqui.some((r) => Number(r["valor"]) === valorLiqui && confereMovimento(r));
  return {
    valor:
      valorLiqui === null && extrato.length === 0
        ? null
        : (Math.round((valorLiqui ?? 0) * 100) + total) / 100,
    contabilizada:
      liquidacaoContabilizada && extrato.every(confereMovimento) && elegiveis.length > 0,
    conferir: rows.some((r) => !confereMovimento(r)),
    origem: valorLiqui !== null ? (extrato.length ? "LIQUI + extrato" : "LIQUI") : "Extrato",
  };
}
