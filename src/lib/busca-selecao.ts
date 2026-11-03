/** Busca tolerante a acentos, ordem das palavras e pontuação de documentos/códigos. */
export function normalizarBuscaSelecao(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}
export function correspondeBuscaSelecao(texto: string, busca: string) {
  const base = normalizarBuscaSelecao(texto),
    termo = normalizarBuscaSelecao(busca);
  if (!termo) return true;
  if (termo.split(/\s+/).every((p) => base.includes(p))) return true;
  const digitos = termo.replace(/\D/g, "");
  return /^[\d\s./-]+$/.test(termo) && !!digitos && base.replace(/\D/g, "").includes(digitos);
}
