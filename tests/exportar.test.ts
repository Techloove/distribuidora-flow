import { describe, expect, test } from "bun:test";

import { escapar } from "../src/lib/exportar";

describe("CSV seguro", () => {
  test("neutraliza fórmulas de planilha", () => {
    for (const value of ["=SUM(A1)", "+cmd", "-cmd", "@SUM(A1)", " \t=1+1"]) {
      expect(escapar(value).startsWith("\"'")).toBe(true);
    }
  });

  test("preserva números negativos e escapa aspas", () => {
    expect(escapar(-12)).toBe("\"-12\"");
    expect(escapar('a"b')).toBe("\"a\"\"b\"");
    expect(escapar(null)).toBe("\"\"");
  });
});
