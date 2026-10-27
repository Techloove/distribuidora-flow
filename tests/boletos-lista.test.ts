import { expect, test } from "bun:test";
import { dataBoleto, filtrarBoletos, periodoBoletosInvalido } from "../src/lib/boletos-lista";

const rows = [
  {
    id: "1",
    cliente_id: "a",
    status: "liquidado",
    data_emissao: "2026-10-01",
    vencimento: "2026-10-20",
    data_liquidacao: "2026-10-22",
    valor: 100,
  },
  {
    id: "2",
    cliente_id: "b",
    status: "registrado",
    data_emissao: "2026-10-02",
    vencimento: "2026-10-25",
    data_liquidacao: null,
    valor: 200,
  },
  {
    id: "3",
    cliente_id: "a",
    status: "liquidado",
    data_emissao: "2026-09-30",
    vencimento: "2026-10-20",
    data_liquidacao: "2026-10-21",
    valor: 300,
  },
];
const nome = (id: unknown) => (id === "a" ? "João Construções" : "Ferragens");
test("liquidação até exclui boletos sem data de liquidação e inclui o limite", () => {
  expect(filtrarBoletos(rows, { liquidacao_ate: "2026-10-21" }, nome).map((r) => r.id)).toEqual([
    "3",
  ]);
});
test("combina cliente, emissão, vencimento e liquidação, com limites inclusivos", () => {
  expect(
    filtrarBoletos(
      rows,
      {
        cliente: "a",
        emissao_de: "2026-10-01",
        emissao_ate: "2026-10-01",
        de: "2026-10-20",
        ate: "2026-10-20",
        liquidacao_de: "2026-10-22",
        liquidacao_ate: "2026-10-22",
      },
      nome,
    ).map((r) => r.id),
  ).toEqual(["1"]);
});
test("períodos invertidos não retornam resultados enganosos", () => {
  expect(
    periodoBoletosInvalido({ liquidacao_de: "2026-10-23", liquidacao_ate: "2026-10-21" }),
  ).toBe(true);
  expect(filtrarBoletos(rows, { de: "2026-10-30", ate: "2026-10-01" }, nome)).toEqual([]);
});
test("busca por nome ignora acentos e preserva filtro por situação e valor", () => {
  expect(
    filtrarBoletos(rows, { busca: "joao", status: "liquidado", max: "150" }, nome).map((r) => r.id),
  ).toEqual(["1"]);
});
test("limpar os filtros mantém todos os boletos recebidos e não altera a coleção", () => {
  expect(filtrarBoletos(rows, {}, nome)).toEqual(rows);
  expect(rows.length).toBe(3);
});
test("datas SQL mantêm o dia e valores ausentes ou impossíveis não viram datas", () => {
  expect(dataBoleto("2026-10-01")).toBe("2026-10-01");
  for (const value of [null, "", "2026-02-30", "2026-10-01T00:00:00Z"])
    expect(dataBoleto(value)).toBe("");
});
