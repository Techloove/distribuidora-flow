/** O saldo da listagem já inclui ajustes anteriores e valores pagos.
 * Aqui entram somente juros, multa e desconto novos desta baixa. */
export function recalcularBaixa(saldo: number, juros: number, multa: number, desconto: number) {
  const valores = [saldo, juros, multa, desconto];
  if (valores.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const centavos = valores.map((v) => Math.round((v + Number.EPSILON) * 100));
  if (centavos.some((v) => !Number.isSafeInteger(v))) return null;
  const total = centavos[0]! + centavos[1]! + centavos[2]! - centavos[3]!;
  if (total < 0 || !Number.isSafeInteger(total)) return null;
  return {
    saldo: centavos[0]! / 100,
    juros: centavos[1]! / 100,
    multa: centavos[2]! / 100,
    desconto: centavos[3]! / 100,
    total: total / 100,
  };
}
