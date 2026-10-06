import { expect, test } from "bun:test";
import { validarNovoVencimento, vencimentoDoBanco } from "../src/lib/sicredi-vencimento";
import { MODULOS, moduloDaRota, normalizarModulo } from "../src/lib/permissoes";
test("vencimento usa calendário válido e o dia de São Paulo", () => {
  const midnightUTC = new Date("2026-10-07T01:00:00Z");
  expect(validarNovoVencimento("2026-10-06", midnightUTC)).toBe("2026-10-06");
  expect(() => validarNovoVencimento("2026-10-05", midnightUTC)).toThrow();
  expect(() => validarNovoVencimento("2026-02-30", midnightUTC)).toThrow();
  expect(vencimentoDoBanco("20/11/2026")).toBe("2026-11-20");
  expect(vencimentoDoBanco("2026-11-20")).toBe("2026-11-20");
  expect(vencimentoDoBanco("invalido")).toBeNull();
});
test("há um único menu de boletos e as permissões antigas continuam válidas", () => {
  expect(MODULOS.some((m) => m.path === "/faturamento")).toBe(false);
  expect(MODULOS.filter((m) => m.path === "/boletos")).toHaveLength(1);
  expect(moduloDaRota("/faturamento")).toBe("/boletos");
  expect(normalizarModulo("/faturamento")).toBe("/boletos");
  expect(normalizarModulo("/receber")).toBe("/receber");
});
