/** Busca tolerante a acentos, ordem das palavras e pontuação de documentos/códigos. */
export function normalizarBuscaSelecao(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}
export type TextoBuscaPreparado = { base: string; digitos: string };
export type TermoBuscaPreparado = { palavras: string[]; digitos: string };
export function prepararTextoBusca(texto: string): TextoBuscaPreparado {
  const base = normalizarBuscaSelecao(texto);
  return { base, digitos: base.replace(/\D/g, "") };
}
export function prepararTermoBusca(busca: string): TermoBuscaPreparado {
  const termo = normalizarBuscaSelecao(busca);
  return {
    palavras: termo ? termo.split(/\s+/) : [],
    digitos: /^[\d\s./-]+$/.test(termo) ? termo.replace(/\D/g, "") : "",
  };
}
export function correspondeBuscaPreparada(texto: TextoBuscaPreparado, busca: TermoBuscaPreparado) {
  return (
    busca.palavras.every((p) => texto.base.includes(p)) ||
    (!!busca.digitos && texto.digitos.includes(busca.digitos))
  );
}
export function correspondeBuscaSelecao(texto: string, busca: string) {
  return correspondeBuscaPreparada(prepararTextoBusca(texto), prepararTermoBusca(busca));
}
