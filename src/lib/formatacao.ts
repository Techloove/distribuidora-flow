/** Padrão único de exibição monetária: reais, separadores brasileiros e duas casas. */
const moedaBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const brl = (value: unknown) => moedaBRL.format(Number(value ?? 0));

/** Exibição de calendário; o valor ISO usado no banco e nos filtros é preservado. */
export function dataBr(value: unknown): string {
  const texto = String(value ?? "").trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
  const mensal = /^(\d{1,2})\/(\d{4})$/.exec(texto);
  const s = br ? `${br[3]}-${br[2]}-${br[1]}` : mensal ? `${mensal[2]}-${mensal[1]}` : texto;
  if (/^\d{4}-\d{1,2}$/.test(s)) return mesBr(s);
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T ])/.exec(s);
  if (!match) return "—";
  const [, ano, mes, dia] = match;
  const iso = `${ano}-${mes!.padStart(2, "0")}-${dia!.padStart(2, "0")}`;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso
    ? `${dia!.padStart(2, "0")}/${mes!.padStart(2, "0")}/${ano}`
    : "—";
}
/** Competência mensal em MM/AAAA, sem alterar ordenação ou agrupamentos. */
export function mesBr(value: unknown): string {
  const texto = String(value ?? "").trim();
  const brasileiro = /^(\d{1,2})\/(\d{4})$/.exec(texto);
  const match = /^(\d{4})-(\d{1,2})(?:$|-)/.exec(
    brasileiro ? `${brasileiro[2]}-${brasileiro[1]}` : texto,
  );
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return "—";
  return `${match[2]!.padStart(2, "0")}/${match[1]}`;
}

/** Eventos com horário usam calendário brasileiro e o fuso da operação. */
export function dataHoraBr(value: unknown): string {
  const texto = String(value ?? "").trim();
  if (!/[T ]\d{2}:\d{2}/.test(texto)) return dataBr(texto);
  const data = new Date(texto);
  return Number.isFinite(data.getTime())
    ? data.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";
}
