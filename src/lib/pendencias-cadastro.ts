type Cadastro = Record<string, unknown>;
const texto = (v: unknown) => String(v ?? "").trim();
const normal = (v: unknown) =>
  texto(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
/** Somente ausência de dados; não substitui validação fiscal ou consulta cadastral. */
export function camposFaltantesCliente(r: Cadastro): string[] {
  const faltas: string[] = [];
  const pf = normal(r["tipo_pessoa"]) === "PF";
  if (!texto(r["cnpj_cpf"]).replace(/\D/g, "")) faltas.push(pf ? "CPF" : "CNPJ");
  const pessoa = r["pessoa_fiscal"];
  const fiscal =
    pessoa && typeof pessoa === "object" && !Array.isArray(pessoa) ? (pessoa as Cadastro) : r;
  const icms = normal(fiscal["indicador_contribuinte_icms"]);
  const isento =
    /^(2|9)(?:\D|$)/.test(icms) ||
    /^(ISENTO|CONTRIBUINTE ISENTO)\b/.test(icms) ||
    icms.includes("NAO CONTRIBUINTE") ||
    ["ISENTO", "ISENTA"].includes(normal(fiscal["situacao_inscricao_estadual"]));
  if (!pf && !isento && !texto(r["inscricao_estadual"])) faltas.push("Inscrição estadual");
  if (!texto(r["rota_id"])) faltas.push("Rota");
  if (!texto(r["representante_id"])) faltas.push("Representante");
  const endereco = [
    ["logradouro", "logradouro"],
    ["numero", "número"],
    ["bairro", "bairro"],
    ["cidade", "cidade"],
    ["uf", "UF"],
    ["cep", "CEP"],
  ].filter(([campo]) => !texto(r[campo!]));
  if (endereco.length) faltas.push(`Endereço (${endereco.map(([, label]) => label).join(", ")})`);
  return faltas;
}
