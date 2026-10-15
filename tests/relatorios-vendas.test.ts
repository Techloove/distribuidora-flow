import { expect, test } from "bun:test";
import { periodoMesVendas, variacaoVendas } from "../src/lib/relatorios-vendas";

test("período mensal respeita ano bissexto e virada de ano", () => {
  expect(periodoMesVendas("2024-02")).toEqual({ inicio: "2024-02-01", fim: "2024-02-29" });
  expect(periodoMesVendas("2026-02")).toEqual({ inicio: "2026-02-01", fim: "2026-02-28" });
  expect(periodoMesVendas("2026-12")).toEqual({ inicio: "2026-12-01", fim: "2026-12-31" });
});
test("comparação indica ausência de base sem inventar crescimento", () => {
  expect(variacaoVendas(100, 0)).toBeNull();
  expect(variacaoVendas(100, undefined)).toBeNull();
  expect(variacaoVendas(150, 100)).toBe(50);
  expect(variacaoVendas(0, 100)).toBe(-100);
});
test("sair de prejuízo para lucro resulta em variação positiva", () => {
  expect(variacaoVendas(50, -100)).toBe(150);
  expect(variacaoVendas(-150, -100)).toBe(-50);
});
