/** Retorna somente dados conhecidos do formulário, sem sobrescrever digitação manual. */
export function preencherCadastroRepresentante(
  atual: Record<string, string>,
  documentoConsultado: string,
  dados: object,
): Record<string, string> {
  const digitos = (v: string) => v.replace(/\D/g, "");
  if (digitos(atual["cnpj_cpf"] ?? "") !== digitos(documentoConsultado)) return {};
  const resultado: Record<string, string> = {};
  for (const campo of [
    "razao_social",
    "nome_fantasia",
    "inscricao_estadual",
    "email",
    "telefone",
    "cep",
    "logradouro",
    "numero",
    "complemento",
    "bairro",
    "cidade",
    "uf",
  ]) {
    const valor = (dados as Record<string, unknown>)[campo];
    if (!(atual[campo] ?? "").trim() && typeof valor === "string" && valor.trim())
      resultado[campo] = valor.trim();
  }
  return resultado;
}
