import { expect, test } from "bun:test";
import {
  preencherCadastroRepresentante,
  inscricaoUnicaParaPreencher,
  preencherCadastroAdministrativo,
} from "../src/lib/consulta-cliente-representante";
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

test("IE automática seleciona o estabelecimento, mantém zero inicial e rejeita registros incoerentes", () => {
  const r = { inscricao: "081385420", uf: "ES", situacao: "Sem restrição" };
  expect(inscricaoUnicaParaPreencher([r], "ES")).toBe("081385420");
  expect(inscricaoUnicaParaPreencher([r, r], "ES")).toBe("081385420");
  expect(inscricaoUnicaParaPreencher([r, { ...r, uf: "MG", inscricao: "999999999" }], "ES")).toBe(
    "081385420",
  );
  expect(inscricaoUnicaParaPreencher([r, { ...r, inscricao: "999999999" }], "ES")).toBeNull();
  expect(inscricaoUnicaParaPreencher([{ ...r, situacao: "INATIVA" }], "ES")).toBeNull();
  expect(inscricaoUnicaParaPreencher([r], "MG")).toBeNull();
  expect(inscricaoUnicaParaPreencher([], "ES")).toBeNull();
});
test("preenchimento administrativo inclui dados cadastrais sem substituir dados manuais ou comerciais", () => {
  const patch = preencherCadastroAdministrativo(
    { cnpj_cpf: "11222333000181", razao_social: "Nome manual", limite_credito: "500" },
    "11222333000181",
    {
      razao_social: "Nome da fonte",
      nome_fantasia: "Fantasia",
      data_abertura: "05/11/2026",
      natureza_juridica: "Sociedade",
      limite_credito: "999999",
      rota_id: "outra",
      status: "ativo",
    },
  );
  expect(patch).toEqual({
    nome_fantasia: "Fantasia",
    data_abertura: "2026-11-05",
    natureza_juridica: "Sociedade",
  });
  expect(
    preencherCadastroAdministrativo({ cnpj_cpf: "outro" }, "11222333000181", {
      nome_fantasia: "Fantasia",
    }),
  ).toEqual({});
});
