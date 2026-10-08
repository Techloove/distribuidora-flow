import { describe, it, expect } from "bun:test";
import {
  lerExtratoCsv,
  candidatosConciliacao,
  prioridadeComercial,
} from "../src/lib/rotinas-distribuidora";
describe("rotinas da distribuidora", () => {
  it("aceita CSV de planilha com aspas, delimitador no histórico e CRLF", () => {
    const r = lerExtratoCsv(
      '"referencia";"data";"valor";"descricao"\r\n"TX1";"2026-10-08";"12,50";"Histórico; com ""aspas"""',
    );
    expect(r[0]).toEqual({
      referencia: "TX1",
      data: "2026-10-08",
      valor: 12.5,
      descricao: 'Histórico; com "aspas"',
    });
    expect(() =>
      lerExtratoCsv('referencia;data;valor;descricao\nTX1;2026-10-08;12;"Não fechado'),
    ).toThrow();
  });
  it("valida valores, datas e referências antes de importar um extrato", () => {
    expect(
      lerExtratoCsv(
        "referencia;data;valor;descricao\nTX1;2026-10-08;12,50;Entrada\nTX2;2026-10-08;-3.25;Tarifa",
      ).map((l) => l.valor),
    ).toEqual([12.5, -3.25]);
    for (const linha of [
      "X;2026-02-30;12;Teste",
      "X;2026-10-08;1.000,00;Teste",
      "X;2026-10-08;0;Teste",
      "X;2026-10-08;NaN;Teste",
    ])
      expect(() => lerExtratoCsv("referencia;data;valor;descricao\n" + linha)).toThrow();
    expect(() =>
      lerExtratoCsv("referencia;data;valor;descricao\nX;2026-10-08;1;A\nX;2026-10-08;1;B"),
    ).toThrow();
  });
  it("não sugere outra conta, sinal diferente ou movimento estornado", () => {
    const m = [
      { id: "1", conta_id: "a", valor: 10, tipo: "saida", status: "ativo", data: "2026-10-08" },
      { id: "2", conta_id: "b", valor: 10, tipo: "saida", status: "ativo", data: "2026-10-08" },
      { id: "3", conta_id: "a", valor: 10, tipo: "entrada", status: "ativo", data: "2026-10-08" },
      { id: "4", conta_id: "a", valor: 10, tipo: "saida", status: "estornado", data: "2026-10-08" },
    ];
    expect(
      candidatosConciliacao({ conta_id: "a", valor: -10, data: "2026-10-08" }, m).map(
        (r) => r["id"],
      ),
    ).toEqual(["1"]);
  });
  it("prioriza clientes sem compra, inativos e redução de consumo", () => {
    expect(prioridadeComercial({}, "2026-10-08")).toBe("Nunca comprou");
    expect(prioridadeComercial({ ultima_compra: "2026-09-01" }, "2026-10-08")).toBe("Reativar");
    expect(
      prioridadeComercial(
        { ultima_compra: "2026-10-01", vendas_30: 50, vendas_anteriores_30: 100 },
        "2026-10-08",
      ),
    ).toBe("Compra em queda");
  });
});
