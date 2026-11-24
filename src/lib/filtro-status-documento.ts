export function statusSelecionados(valor: string) {
  return new Set(valor.split(",").filter(Boolean));
}
export function alternarStatusSelecionado(valor: string, status: string) {
  const selecionados = statusSelecionados(valor);
  if (selecionados.has(status)) selecionados.delete(status);
  else selecionados.add(status);
  return [...selecionados].sort().join(",");
}
