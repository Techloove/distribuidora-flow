import { brl, dataBr } from "./formatacao";
function escalar(valor: string | number, casas: number): bigint | null {
  const texto = String(valor).trim().replace(",", ".");
  const partes = /^(\d+)(?:\.(\d+))?$/.exec(texto);
  if (!partes || (partes[2]?.length ?? 0) > casas) return null;
  return BigInt(partes[1]! + (partes[2] ?? "").padEnd(casas, "0"));
}
/** Mesma regra do PostgreSQL: percentual sobre a referência, arredondando só ao final em centavos. */
export function mensalidadePorSalario(
  salario: string | number,
  percentual: string | number,
): number | null {
  const base = escalar(salario, 2),
    taxa = escalar(percentual, 4);
  if (
    base == null ||
    taxa == null ||
    base <= 0n ||
    base > 9999999900n ||
    taxa <= 0n ||
    taxa > 1000000n
  )
    return null;
  const centavos = (base * taxa + 500000n) / 1000000n;
  return centavos > 0n ? Number(centavos) / 100 : null;
}
export function textoMensalidadePorSalario(
  salario: string | number,
  percentual: string | number,
): string {
  const valor = mensalidadePorSalario(salario, percentual);
  return valor == null ? "Confira os valores" : brl(valor);
}

/** Primeiro vencimento pré-pago após dias gratuitos, sem conversão para o fuso local. */
export function primeiroVencimentoComCarencia(inicio: string, dias: number): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(inicio) ||
    dataBr(inicio) === "—" ||
    !Number.isInteger(dias) ||
    dias < 0 ||
    dias > 365
  )
    return "";
  const data = new Date(`${inicio}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}
