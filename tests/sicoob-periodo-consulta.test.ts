import { expect, test } from "bun:test";
import { periodoRecuperacaoSicoob } from "../src/lib/sicoob-api";

test("recuperação amplia o vencimento original em 30 dias em cada direção", () => {
  expect(periodoRecuperacaoSicoob("2026-11-14")).toEqual([
    { dataInicio: "2026-10-15", dataFim: "2026-11-14" },
    { dataInicio: "2026-11-15", dataFim: "2026-12-14" },
  ]);
});

test("janela atravessa ano e fevereiro bissexto sem desvio de fuso", () => {
  expect(periodoRecuperacaoSicoob("2027-01-01")).toEqual([
    { dataInicio: "2026-12-02", dataFim: "2027-01-01" },
    { dataInicio: "2027-01-02", dataFim: "2027-01-31" },
  ]);
  expect(periodoRecuperacaoSicoob("2028-03-01")).toEqual([
    { dataInicio: "2028-01-31", dataFim: "2028-03-01" },
    { dataInicio: "2028-03-02", dataFim: "2028-03-31" },
  ]);
});

test("data ausente ou impossível impede consulta sem limites válidos", () => {
  for (const data of [undefined, "", "2026-02-30", "14/11/2026"])
    expect(() => periodoRecuperacaoSicoob(data)).toThrow("Data bancária inválida");
});

import { consultarPagadorSicoob } from "../src/lib/sicoob-consulta";

test("consulta todas as janelas mesmo com 204 e respeita limite do banco", async () => {
  const caminhos: string[] = [];
  const registro = { nossoNumero: 123, seuNumero: "original" };
  const resultado = await consultarPagadorSicoob(
    async (path) => {
      caminhos.push(path);
      const q = new URL(path, "https://exemplo.test").searchParams;
      const dias =
        (Date.parse(q.get("dataFim")!) - Date.parse(q.get("dataInicio")!)) / 86400000 + 1;
      expect(dias).toBeLessThanOrEqual(35);
      expect(q.get("numeroCliente")).toBe("4163036");
      expect(q.get("codigoSituacao")).toBeNull();
      return caminhos.length === 1
        ? { status: 204, json: {} }
        : { status: 200, json: { resultado: [registro] } };
    },
    4163036,
    "11122233300",
    "2026-11-14",
  );
  expect(caminhos).toHaveLength(2);
  expect(resultado).toEqual([registro]);
});

test("falha na segunda janela impede usar resultado parcial", async () => {
  let chamadas = 0;
  await expect(
    consultarPagadorSicoob(
      async () => {
        chamadas++;
        return chamadas === 1
          ? { status: 200, json: { resultado: [{ nossoNumero: 123 }] } }
          : { status: 403, json: {}, motivo: "Forbidden" };
      },
      4163036,
      "11122233300",
      "2026-11-14",
    ),
  ).rejects.toThrow("HTTP 403");
});

import { condicoesSicoob } from "../src/lib/sicoob-api";
test("situação desconhecida nunca confirma título e informa somente diagnóstico limitado", () => {
  expect(() => condicoesSicoob({ situacaoBoleto: "Em processamento" })).toThrow("EM PROCESSAMENTO");
  expect(() => condicoesSicoob({})).toThrow("não informada pelo banco");
  expect(() => condicoesSicoob({ situacaoBoleto: "token=segredo" })).toThrow(
    "Situação Sicoob não reconhecida. Confira",
  );
});
