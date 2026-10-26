const ETAPAS = [
  "separacao",
  "separado",
  "conferido",
  "faturado",
  "nf_emitida",
  "em_carga",
  "em_rota",
  "entregue",
];
/** Apenas avanços operacionais; uma NF nunca é criada por regularização. */
export function destinosRegularizacao(status: string): string[] {
  const pos = ETAPAS.indexOf(status);
  return pos < 0 ? [] : ETAPAS.slice(pos + 1).filter((s) => s !== "nf_emitida");
}
