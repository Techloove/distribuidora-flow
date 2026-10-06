export function validarNovoVencimento(value: string, now = new Date()) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error("Informe uma data válida para o vencimento.");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  if (value < today) throw new Error("O novo vencimento não pode estar no passado.");
  return value;
}
export function vencimentoDoBanco(value: unknown) {
  const date = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) return date.split("/").reverse().join("-");
  return null;
}
