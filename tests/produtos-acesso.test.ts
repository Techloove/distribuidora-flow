import { expect, test } from "bun:test";
import {
  podeVerCustosProduto,
  CAMPOS_CUSTO_PRODUTO,
  tabelaLeituraCadastro,
} from "../src/lib/produtos-acesso";
test("custos de produto dependem do perfil com precedência explícita de administrador", () => {
  for (const roles of [
    [],
    ["representante"],
    ["representante", "gestor"],
    ["representante", "financeiro"],
  ])
    expect(podeVerCustosProduto(roles)).toBe(false);
  for (const roles of [["admin"], ["representante", "admin"], ["gestor"], ["financeiro"]])
    expect(podeVerCustosProduto(roles)).toBe(true);
  expect([...CAMPOS_CUSTO_PRODUTO]).toContain("ultimo_custo");
  expect([...CAMPOS_CUSTO_PRODUTO]).toContain("custo_medio");
  expect([...CAMPOS_CUSTO_PRODUTO]).toContain("markup_percentual");
  expect(tabelaLeituraCadastro("produtos")).toBe("produtos_consulta_324");
  expect(tabelaLeituraCadastro("pessoas")).toBe("pessoas");
});
