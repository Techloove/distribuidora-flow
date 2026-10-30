import { expect, test } from "bun:test";
import { brl } from "../src/lib/formatacao";
const normal = (valor: unknown) => brl(valor).replace(/\u00a0/g, " ");
test("padrão BRL: duas casas, vírgula decimal, milhares e valores negativos", () => {
  expect(normal(2.9)).toBe("R$ 2,90");
  expect(normal("7.2")).toBe("R$ 7,20");
  expect(normal("6.79")).toBe("R$ 6,79");
  expect(normal(0)).toBe("R$ 0,00");
  expect(normal(null)).toBe("R$ 0,00");
  expect(normal(1234567.89)).toBe("R$ 1.234.567,89");
  expect(normal(-2.9)).toBe("-R$ 2,90");
});
test("arredondamento é apenas visual e preserva o número usado no cálculo", () => {
  const valor = 7.234567;
  expect(normal(valor)).toBe("R$ 7,23");
  expect(valor).toBe(7.234567);
  expect(normal(2.905)).toBe("R$ 2,91");
});
