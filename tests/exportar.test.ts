import { describe, expect, test } from "bun:test";

import { escapar, conteudoCsv } from "../src/lib/exportar";

describe("CSV seguro", () => {
  test("relatórios exibem datas brasileiras e modelos técnicos conservam ISO", () => {
    const rows = [{ data: "2026-10-15", mes: "2026-11", codigo: "2026-10-15" }];
    const csv = conteudoCsv(
      [
        { key: "data", label: "Data", formato: "data" },
        { key: "mes", label: "Mês", formato: "mes" },
        { key: "codigo", label: "Código" },
      ],
      rows,
    );
    expect(csv).toContain('"15/10/2026";"11/2026";"2026-10-15"');
    expect(conteudoCsv([{ key: "data", label: "data" }], rows)).toContain('"2026-10-15"');
    expect(rows[0]!.data).toBe("2026-10-15");
    expect(conteudoCsv([{ key: "nome", label: "Nome" }], [{ nome: "=1+1" }])).toContain('"\'=1+1"');
  });
  test("neutraliza fórmulas de planilha", () => {
    for (const value of ["=SUM(A1)", "+cmd", "-cmd", "@SUM(A1)", " \t=1+1"]) {
      expect(escapar(value).startsWith("\"'")).toBe(true);
    }
  });

  test("preserva números negativos e escapa aspas", () => {
    expect(escapar(-12)).toBe('"-12"');
    expect(escapar('a"b')).toBe('"a""b"');
    expect(escapar(null)).toBe('""');
  });
});
