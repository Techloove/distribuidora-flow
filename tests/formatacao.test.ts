import { expect, test } from "bun:test";
import { dataBr, mesBr } from "../src/lib/formatacao";
test("datas financeiras usam dia/mês/ano sem conversão de fuso", () => {
  expect(dataBr("2026-11-04")).toBe("04/11/2026");
  expect(dataBr("2026-10-29T00:00:00Z")).toBe("29/10/2026");
  expect(dataBr(null)).toBe("—");
  expect(dataBr("2026-02-30")).toBe("—");
});

test("datas e competências têm zeros, ordem brasileira e calendário válido", () => {
  for (const [entrada, saida] of [
    ["2026-10-5", "05/10/2026"],
    ["2026-1-5", "05/01/2026"],
    ["5/1/2026", "05/01/2026"],
    ["2026-10", "10/2026"],
    ["2026-1", "01/2026"],
    ["1/2026", "01/2026"],
    ["2024-02-29", "29/02/2024"],
  ])
    expect(dataBr(entrada)).toBe(saida!);
  for (const x of ["2026-13-01", "2026-02-29", "2026-00", "2026-13", "2026-02-30", "abc", ""])
    expect(dataBr(x)).toBe("—");
  expect(mesBr("2026-10-01")).toBe("10/2026");
  expect(mesBr("2026-1")).toBe("01/2026");
  expect(mesBr(null)).toBe("—");
});
