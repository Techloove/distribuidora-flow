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
