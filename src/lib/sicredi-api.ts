/** Contratos da API de cobrança Sicredi 3.9.1. */
export const SICREDI_SANDBOX = {
  cooperativa: "6789",
  posto: "03",
  beneficiario: "12345",
  username: "123456789",
  password: "teste123",
} as const;
function money(value: unknown, name: string) {
  if (typeof value !== "number" && typeof value !== "string")
    throw new Error(`Sicredi não informou ${name}.`);
  const raw = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(`Valor bancário inválido para ${name}.`);
  const n = Number(raw);
  if (!Number.isSafeInteger(Math.round(n * 100)) || n > 999999999999.99)
    throw new Error(`Valor bancário inválido para ${name}.`);
  return n;
}
function isoDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function liquidacaoSicredi(json: Record<string, unknown>) {
  const raw = json["dadosLiquidacao"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(
      "Sicredi não informou os dados de liquidação. Concilie antes de baixar o título.",
    );
  const d = raw as Record<string, unknown>;
  let data = String(json["dataMovimento"] ?? "");
  if (data && !isoDate(data))
    throw new Error("Sicredi informou data de movimento inválida. Nenhuma baixa foi registrada.");
  if (!isoDate(data)) {
    const source = String(d["data"] ?? "");
    if (isoDate(source)) data = source;
    else if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(source) &&
      isoDate(source.slice(0, 10)) &&
      Number.isFinite(Date.parse(source))
    )
      data = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(source));
    else throw new Error("Sicredi não informou uma data válida de liquidação.");
  }
  const valor = money(d["valor"], "valor liquidado");
  if (valor <= 0) throw new Error("Liquidação bancária deve ter valor positivo.");
  return {
    data,
    valor,
    juros: money(d["juros"] ?? 0, "juros"),
    multa: money(d["multa"] ?? 0, "multa"),
    desconto: money(d["desconto"] ?? 0, "desconto"),
    abatimento: money(d["abatimento"] ?? 0, "abatimento"),
  };
}
export function linhaDigitavelSicredi(value: unknown) {
  const line = String(value ?? "").replace(/[ .-]/g, "");
  if (!/^748\d{44}$/.test(line))
    throw new Error(
      "Boleto sem linha digitável Sicredi válida (47 dígitos). Confira o registro no banco.",
    );
  return line;
}
