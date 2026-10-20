/** Identidade pública da loja usada pelo modelo compartilhado de impressão. */
export function identidadeLoja(loja: Record<string, unknown>, empresa: Record<string, unknown>) {
  const identidade = { ...empresa };
  for (const campo of [
    "razao_social",
    "nome_fantasia",
    "cnpj",
    "inscricao_estadual",
    "email",
    "telefone",
    "logradouro",
    "numero",
    "bairro",
    "cidade",
    "uf",
    "cep",
    "logo_url",
  ]) {
    if (loja[campo] !== undefined) identidade[campo] = loja[campo] ?? "";
  }
  identidade["nome_fantasia"] =
    loja["nome_fantasia"] || loja["nome"] || identidade["nome_fantasia"];
  return identidade;
}
export function logoLojaValida(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.length > 350000) return null;
  if (
    /^https:\/\/[^\s<>]+$/.test(valor) ||
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(valor)
  )
    return valor;
  return null;
}
