import { expect, test } from "bun:test";
import { dataBr } from "../src/lib/formatacao";
test("datas financeiras usam dia/mês/ano sem conversão de fuso", () => {
  expect(dataBr("2026-11-04")).toBe("04/11/2026");
  expect(dataBr("2026-10-29T00:00:00Z")).toBe("29/10/2026");
  expect(dataBr(null)).toBe("—");
  expect(dataBr("2026-02-30")).toBe("—");
});
