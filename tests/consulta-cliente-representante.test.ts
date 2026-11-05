import { expect, test } from "bun:test";
import { preencherCadastroRepresentante } from "../src/lib/consulta-cliente-representante";
test("consulta do representante preenche dados vazios e preserva digitação e dados comerciais", () => {
  const atual = {
    cnpj_cpf: "12.345.678/0001-90",
    razao_social: "Nome digitado",
    centro_id: "loja-permitida",
    telefone: "",
  };
  const patch = preencherCadastroRepresentante(atual, "12345678000190", {
    razao_social: "Nome da fonte",
    telefone: " 12345 ",
    cidade: "Cidade",
    limite_credito: "99999",
    rota_id: "rota-alheia",
    credito_pendente: false,
    representante_id: "outro",
    status: "ativo",
    inscricao_estadual: "123456",
  });
  expect(patch).toEqual({ telefone: "12345", cidade: "Cidade", inscricao_estadual: "123456" });
  expect(
    preencherCadastroRepresentante(atual, "99999999000199", { cidade: "Outra cidade" }),
  ).toEqual({});
  expect(
    preencherCadastroRepresentante(atual, "12345678000190", {
      email: null,
      cidade: "",
      telefone: { invalido: true },
    }),
  ).toEqual({});
});

test("funções de consulta preservam autorização e recusam CPF no caminho do representante", async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, ["scripts/check-consulta-representante-337.mjs"], {
    encoding: "utf8",
    timeout: 20000,
  });
  expect(r.status, r.stderr || r.stdout).toBe(0);
}, 25000);
