import { expect, test } from "bun:test";
import {
  pendenciasTributacao,
  prepararProdutoFaznotas,
  tributosSchema,
  type TributosConfig,
} from "../src/lib/faznotas-tributos";
const config: TributosConfig = {
  icms: { estados: [{ estado: "ES", "icms-cst": "102", aliquotas: { "aliquota-icms": "0" } }] },
  "pis-cofins": { "pis-cst": "49", "cofins-cst": "49" },
  "cbs-ibs": {
    "cbs-ibs-cst": "000",
    classificacao: "000001",
    aliquotas: { "percentual-cbs": "0", "percentual-ibs": "0" },
  },
};
const produto = {
  codigo: "23",
  descricao: "Cimento",
  ncm: "25232910",
  unidade: "SC",
  origem_fiscal: "0",
  cest: "1002800",
  ean: "7894900011517",
};
test("regra tributária respeita UF e CRT, incluindo zeros informados expressamente", () => {
  expect(pendenciasTributacao(config, "5102", "ES", "1", false)).toEqual([]);
  expect(pendenciasTributacao(config, "6102", "ES", "1", false)).toContain(
    "CFOP incompatível com a UF ES",
  );
  expect(pendenciasTributacao(config, "5102", "ES", "3", false).join(" ")).toContain(
    "incompatível com o CRT",
  );
  const normal = structuredClone(config);
  normal.icms!.estados[0]!["icms-cst"] = "00";
  expect(pendenciasTributacao(normal, "5102", "ES", "3", false)).toEqual([]);
});
test("IBS/CBS omitido exige confirmação explícita, nunca recebe padrões locais", () => {
  const semCbs = structuredClone(config);
  delete semCbs["cbs-ibs"];
  expect(pendenciasTributacao(semCbs, "5102", "ES", "1", false).join(" ")).toContain(
    "padrões do provedor",
  );
  expect(pendenciasTributacao(semCbs, "5102", "ES", "1", true)).toEqual([]);
  const incompleto = structuredClone(config);
  delete incompleto["cbs-ibs"]!.aliquotas["percentual-cbs"];
  expect(pendenciasTributacao(incompleto, "5102", "ES", "1", false).join(" ")).toContain(
    "incluindo zero",
  );
});
test("contrato fechado rejeita campos inventados, UF repetida, número em vez de string e alíquotas inválidas", () => {
  expect(tributosSchema.safeParse({ ...config, token: "nao-permitido" }).success).toBe(false);
  expect(
    tributosSchema.safeParse({
      ...config,
      icms: { estados: [...config.icms!.estados, ...config.icms!.estados] },
    }).success,
  ).toBe(false);
  expect(
    tributosSchema.safeParse({ ...config, ipi: { "ipi-cst": "99", "ipi-aliquota": 0 } }).success,
  ).toBe(false);
  expect(
    tributosSchema.safeParse({ ...config, ipi: { "ipi-cst": "99", "ipi-aliquota": "-1" } }).success,
  ).toBe(false);
  expect(
    tributosSchema.safeParse({ ...config, ipi: { "ipi-cst": "99", "ipi-aliquota": "100.1" } })
      .success,
  ).toBe(false);
  expect(
    tributosSchema.safeParse({
      ...config,
      icms: {
        estados: [
          {
            estado: "ES",
            "icms-cst": "102",
            aliquotas: { "aliquota-mva": "120.50", "codigo-beneficiario": "ES020110" },
          },
        ],
      },
    }).success,
  ).toBe(true);
});
test("prévia de cadastro contém apenas propriedades documentadas e bloqueia revisão desatualizada", () => {
  const body = prepararProdutoFaznotas(produto, [
    { cfop: "5102", configuracoes: config, revisao_valida: true },
  ]);
  expect(
    body["configuracoes-fiscais"][0]!.configuracoes["cbs-ibs"]!.aliquotas["percentual-cbs"],
  ).toBe("0");
  expect(body).not.toHaveProperty("cest");
  expect(body).not.toHaveProperty("ean");
  expect(body).not.toHaveProperty("token");
  expect(body).not.toHaveProperty("valor");
  expect(() =>
    prepararProdutoFaznotas(produto, [
      { cfop: "5102", configuracoes: config, revisao_valida: false },
    ]),
  ).toThrow("atualizadas");
  expect(() =>
    prepararProdutoFaznotas({ ...produto, ncm: "123" }, [
      { cfop: "5102", configuracoes: config, revisao_valida: true },
    ]),
  ).toThrow("NCM");
});
