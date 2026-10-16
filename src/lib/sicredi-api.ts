/** Contratos da API de cobrança Sicredi 3.9.1/4.0 (operações utilizadas). */
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

/** Somente mensagens conhecidas de validação; nunca devolve corpo bruto, headers ou payload. */
export function motivoRecusaSicredi(body: string, secrets: readonly string[] = []): string | null {
  if (!body || body.length > 32_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const messages: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 3 || messages.length >= 3 || !value) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 10)) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    for (const key of ["mensagem", "message", "detail", "error_description"]) {
      if (typeof row[key] === "string" && row[key].trim()) {
        messages.push(row[key] as string);
        break;
      }
    }
    for (const key of ["erros", "errors", "violations", "violacoes"]) visit(row[key], depth + 1);
    if (typeof row["error"] === "object") visit(row["error"], depth + 1);
  };
  visit(parsed, 0);
  const clean = (value: string) => {
    let text = value;
    for (const secret of secrets.filter(Boolean)) {
      for (const form of [secret, encodeURIComponent(secret)])
        text = text.split(form).join("[oculto]");
    }
    return text
      .replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [oculto]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[oculto]")
      .replace(
        /((?:x-api-key|api[_-]?key|password|senha|access[_-]?token|refresh[_-]?token|authorization)\s*[=:]\s*)[^\s,;"']+/gi,
        "$1[oculto]",
      )
      .replace(/[<>]/g, " ")
      .replace(/\p{Cc}/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
  };
  const details = [...new Set(messages.map(clean).filter(Boolean))].slice(0, 3).join(" · ");
  return details ? details.slice(0, 660) : null;
}
