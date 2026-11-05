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

type RegistroIe = {
  inscricao: string;
  uf?: string | undefined;
  situacao?: string | undefined;
  isento?: boolean | undefined;
};
/** Seleciona o registro do estabelecimento, ignorando repetições da fonte e UFs incompatíveis. */
export function registroIeDoEstabelecimento<T extends RegistroIe>(
  registros: readonly T[],
  ufEstabelecimento?: string | undefined,
): T | null {
  const uf = ufEstabelecimento?.trim().toUpperCase();
  const unicos = new Map<string, T>();
  for (const r of registros) {
    const numero = r.inscricao
      .trim()
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, "");
    const status = (r.situacao ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    if (
      !numero ||
      numero === "ISENTO" ||
      r.isento ||
      /INATIV|BAIXAD|CANCELAD|SUSPENS|DESABILIT|NAO HABILIT|NAO CADASTRAD|IRREGULAR/.test(status)
    )
      continue;
    if (uf && r.uf?.trim() && r.uf.trim().toUpperCase() !== uf) continue;
    unicos.set(`${r.uf?.trim().toUpperCase() || uf || ""}:${numero}`, r);
  }
  return unicos.size === 1 ? [...unicos.values()][0]! : null;
}
export function inscricaoUnicaParaPreencher(
  registros: readonly RegistroIe[],
  ufEstabelecimento?: string | undefined,
): string | null {
  return registroIeDoEstabelecimento(registros, ufEstabelecimento)?.inscricao.trim() || null;
}

/** Campos públicos cadastrais para a inclusão administrativa, sem dados comerciais. */
export function preencherCadastroAdministrativo(
  atual: Record<string, string | boolean>,
  documento: string,
  dados: object,
): Record<string, string> {
  if (String(atual["cnpj_cpf"] ?? "").replace(/\D/g, "") !== documento.replace(/\D/g, ""))
    return {};
  const patch: Record<string, string> = {};
  for (const campo of [
    "razao_social",
    "nome_fantasia",
    "situacao_cadastral",
    "data_abertura",
    "data_nascimento",
    "natureza_juridica",
    "porte",
    "cnae_principal",
    "cnae_secundarios",
    "inscricao_estadual",
    "cep",
    "logradouro",
    "numero",
    "complemento",
    "bairro",
    "cidade",
    "uf",
    "telefone",
    "email",
  ]) {
    const valor = (dados as Record<string, unknown>)[campo];
    if (String(atual[campo] ?? "").trim() || typeof valor !== "string" || !valor.trim()) continue;
    let novo = valor.trim();
    if (campo === "data_abertura" || campo === "data_nascimento") {
      const br = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(novo);
      if (br) novo = `${br[3]}-${br[2]}-${br[1]}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(novo)) continue;
    }
    patch[campo] = novo;
  }
  return patch;
}
