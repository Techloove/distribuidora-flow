import { aproveitarCacheCadastral } from "../src/lib/consulta-endereco";
import type { DadosCadastrais } from "../src/lib/consulta-cadastral.functions";
import { describe, expect, test } from "bun:test";
import {
  mapearCep,
  normalizarCep,
  qualidadeEndereco,
  completarEndereco,
} from "../src/lib/consulta-endereco";
describe("Consulta postal e completude do endereço", () => {
  test("normaliza CEP e mapeia ViaCEP sem criar número nem complemento", () => {
    const r = mapearCep(
      {
        cep: "29330-000",
        logradouro: "Rua Teste",
        bairro: "Centro",
        localidade: "Itapemirim",
        uf: "ES",
        ibge: "3202805",
        numero: "999",
        complemento: "até 500",
      },
      normalizarCep("29330-000"),
    );
    expect(r).toEqual({
      cep: "29330000",
      logradouro: "Rua Teste",
      bairro: "Centro",
      cidade: "Itapemirim",
      uf: "ES",
      codigo_ibge: "3202805",
    });
  });
  test("CEP geral não inventa rua e aceita formato BrasilAPI", () => {
    expect(
      mapearCep(
        { cep: "29330000", street: "", neighborhood: "", city: "Itapemirim", state: "ES" },
        "29330000",
      ),
    ).toEqual({ cep: "29330000", cidade: "Itapemirim", uf: "ES" });
  });
  test("recusa CEP divergente, ausente, inexistente ou resposta inválida", () => {
    for (const j of [
      { erro: true },
      { cep: "12345678", localidade: "X", uf: "ES" },
      { cep: "29330000", uf: "ES" },
      {},
    ])
      expect(mapearCep(j, "29330000")).toBeNull();
  });
  test("fontes sem logradouro e número não são consideradas endereço completo", () => {
    expect(qualidadeEndereco({ logradouro: "Rua Teste", numero: "0" })).toBeGreaterThan(
      qualidadeEndereco({ cep: "29330000", cidade: "Itapemirim", uf: "ES" }),
    );
    expect(qualidadeEndereco({ logradouro: "Rua Teste", numero: "S/N" })).toBeGreaterThan(
      qualidadeEndereco({ logradouro: "Rua Teste" }),
    );
  });
});

test("fonte alternativa completa endereço sem trocar identidade ou misturar números de outra rua", () => {
  const antigo: DadosCadastrais = {
    razao_social: "Cliente original",
    cep: "11111111",
    numero: "12",
    bairro: "Antigo",
    complemento: "Galpão antigo",
  };
  const novo: DadosCadastrais = {
    razao_social: "Nome alternativo",
    logradouro: "Rua Nova",
    numero: "S/N",
    cidade: "Itapemirim",
    uf: "ES",
  };
  const r = completarEndereco(antigo, novo);
  expect(r.razao_social).toBe("Cliente original");
  expect(r.logradouro).toBe("Rua Nova");
  expect(r.numero).toBe("S/N");
  expect(r.bairro).toBeUndefined();
  expect(r.cep).toBeUndefined();
  expect(r.complemento).toBeUndefined();
  expect(completarEndereco(r, { razao_social: "Outro", cidade: "X" })).toBe(r);
});

test("prioriza rua e número disponíveis mesmo quando a fonte alternativa não traz CEP", () => {
  expect(qualidadeEndereco({ logradouro: "Rua Nova", numero: "10" })).toBeGreaterThan(
    qualidadeEndereco({
      logradouro: "Rua Antiga",
      cep: "29330000",
      cidade: "Itapemirim",
      uf: "ES",
    }),
  );
});

test("cadastro PJ não reutiliza por 30 dias uma consulta antiga sem rua ou número", () => {
  const agora = Date.parse("2026-10-30T16:00:00Z");
  expect(
    aproveitarCacheCadastral(
      "PJ",
      { logradouro: "", numero: undefined },
      "2026-10-16T02:14:57Z",
      agora,
    ),
  ).toBe(false);
  expect(
    aproveitarCacheCadastral(
      "PJ",
      { logradouro: "AV RAFAEL VALLE DOS REIS", numero: "SN" },
      "2026-10-16T02:14:57Z",
      agora,
    ),
  ).toBe(true);
  expect(
    aproveitarCacheCadastral("PJ", { logradouro: "Avenida" }, "2026-10-30T15:55:00Z", agora),
  ).toBe(true);
  expect(aproveitarCacheCadastral("PJ", {}, "2026-10-30T15:45:00Z", agora)).toBe(false);
  expect(aproveitarCacheCadastral("PJ", {}, "data inválida", agora)).toBe(false);
  expect(aproveitarCacheCadastral("PJ", {}, "2026-10-31T16:00:00Z", agora)).toBe(false);
  expect(aproveitarCacheCadastral("PF", {}, "2026-10-16T02:14:57Z", agora)).toBe(true);
});
