import { expect, test } from "bun:test";
import { mensalidadePorSalario } from "../src/lib/reajuste-saas";
test("percentual do salário arredonda em centavos sem perder precisão", () => {
  expect(mensalidadePorSalario("1621", "23")).toBe(372.83);
  expect(mensalidadePorSalario("2000", "23")).toBe(460);
  expect(mensalidadePorSalario("1.01", "50")).toBe(0.51);
  expect(mensalidadePorSalario("1700.55", "23.125")).toBe(393.25);
  for (const v of ["", "NaN", "Infinity", "-2", "1.234"])
    expect(mensalidadePorSalario(v, 23)).toBeNull();
  expect(mensalidadePorSalario(1000, 101)).toBeNull();
});

test("carência gratuita calcula dias corridos, inclusive fevereiro bissexto", async () => {
  const { primeiroVencimentoComCarencia } = await import("../src/lib/reajuste-saas");
  expect(primeiroVencimentoComCarencia("2026-11-05", 30)).toBe("2026-12-05");
  expect(primeiroVencimentoComCarencia("2028-01-01", 30)).toBe("2028-01-31");
  expect(primeiroVencimentoComCarencia("2028-02-01", 30)).toBe("2028-03-02");
  expect(primeiroVencimentoComCarencia("2026-11-05", 0)).toBe("2026-11-05");
  expect(primeiroVencimentoComCarencia("2026-02-30", 30)).toBe("");
  expect(primeiroVencimentoComCarencia("2026-11-05", -1)).toBe("");
});
