/** Administrador prevalece quando a pessoa também é representante. */
export function podeVerCustosProduto(roles: readonly string[]) {
  return roles.length > 0 && (roles.includes("admin") || !roles.includes("representante"));
}
export const CAMPOS_CUSTO_PRODUTO = new Set([
  "ultimo_custo",
  "custo_medio",
  "markup_percentual",
  "preco_custo",
  "custo_reposicao",
  "margem_minima",
]);
export const tabelaLeituraCadastro = (table: string) =>
  table === "produtos" ? "produtos_consulta_324" : table;
