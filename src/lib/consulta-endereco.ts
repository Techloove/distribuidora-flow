/** CEP não identifica o número do imóvel nem o complemento do cliente. */
export type EnderecoCep = Partial<
  Record<"cep" | "logradouro" | "bairro" | "cidade" | "uf" | "codigo_ibge", string>
>;
const texto = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
export const normalizarCep = (v: string) => v.replace(/\D/g, "");
export function mapearCep(j: Record<string, unknown>, cep: string): EnderecoCep | null {
  if (j["erro"] || j["errors"] || j["type"] === "not_found") return null;
  const recebido = normalizarCep(texto(j["cep"]));
  if (recebido !== cep) return null;
  const cidade = texto(j["localidade"] ?? j["city"]),
    uf = texto(j["uf"] ?? j["state"]).toUpperCase();
  if (!cidade || !/^[A-Z]{2}$/.test(uf)) return null;
  return Object.fromEntries(
    Object.entries({
      cep,
      logradouro: texto(j["logradouro"] ?? j["street"]),
      bairro: texto(j["bairro"] ?? j["neighborhood"]),
      cidade,
      uf,
      codigo_ibge: texto(j["ibge"]),
    }).filter(([, v]) => v),
  );
}
export const CAMPOS_ENDERECO = [
  "cep",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "uf",
] as const;
export function qualidadeEndereco(
  d: Partial<Record<(typeof CAMPOS_ENDERECO)[number], string | undefined>>,
) {
  return (
    (d.logradouro?.trim() ? 16 : 0) +
    (d.numero?.trim() ? 8 : 0) +
    (d.cep?.trim() ? 4 : 0) +
    (d.cidade?.trim() ? 2 : 0) +
    (d.uf?.trim() ? 1 : 0)
  );
}

/** Mantém a identidade da primeira fonte e troca o endereço como um bloco coerente. */
export function completarEndereco<
  T extends Partial<Record<(typeof CAMPOS_ENDERECO)[number], string | undefined>>,
>(atual: T, novo: T): T {
  if (qualidadeEndereco(novo) <= qualidadeEndereco(atual)) return atual;
  return Object.assign({}, atual, Object.fromEntries(CAMPOS_ENDERECO.map((k) => [k, novo[k]])));
}

/** Endereço incompleto não deve ficar preso no cache cadastral de 30 dias.
 * Uma resposta parcial recém-consultada aguarda 15 minutos para evitar consultas repetidas;
 * Consultar novamente sempre ignora o cache, independentemente desta regra.
 */
export function aproveitarCacheCadastral(
  tipo: string,
  dados: { logradouro?: string | undefined; numero?: string | undefined },
  consultadoEm: string,
  agora = Date.now(),
) {
  if (tipo !== "PJ" || (dados.logradouro?.trim() && dados.numero?.trim())) return true;
  const idade = agora - Date.parse(consultadoEm);
  return Number.isFinite(idade) && idade >= 0 && idade < 15 * 60_000;
}
