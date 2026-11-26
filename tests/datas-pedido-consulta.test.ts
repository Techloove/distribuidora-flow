import { expect, test } from "bun:test";
import { lerDatasPedido } from "../src/lib/datas-pedido-consulta";
const datas = {
  data_original: "2026-11-01",
  data_comercial: "2026-11-26",
  data_aprovacao: null,
  data_base_previa: "2026-11-26",
};
test("datas de pedido válidas conservam os prazos retornados pelo servidor", () => {
  expect(lerDatasPedido(datas)).toEqual(datas);
  expect(lerDatasPedido({ ...datas, data_aprovacao: "2026-11-25" }).data_aprovacao).toBe(
    "2026-11-25",
  );
});
test("resposta incompleta ou data inválida não chega ao cálculo de parcelas", () => {
  for (const valor of [
    null,
    [],
    {},
    { ...datas, data_base_previa: undefined },
    { ...datas, data_base_previa: "2026-02-30" },
    { ...datas, data_aprovacao: "inválida" },
  ])
    expect(() => lerDatasPedido(valor)).toThrow(/conferir as datas/);
});
