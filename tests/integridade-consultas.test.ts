import { expect, test } from "bun:test";
import {
  deslocarDataISO,
  saldosPorProduto,
  saldoTitulo,
  selecaoVisivel,
  tituloNoStatus,
  totaisTitulos,
} from "../src/lib/integridade-consultas";
import { hojeSaoPaulo } from "../src/lib/painel-trabalho";

test("estoque sem saldo no centro não herda saldo de outra unidade", () => {
  const rows = [
    { produto_id: "p", centro_id: "A", quantidade: 8 },
    { produto_id: "p", centro_id: "B", quantidade: 12 },
  ];
  expect(saldosPorProduto(rows, "A").get("p")).toBe(8);
  expect(saldosPorProduto(rows, "C").get("p") ?? 0).toBe(0);
  expect(saldosPorProduto(rows, "").get("p")).toBe(20);
});

test("indicadores financeiros isolam centros e distinguem parcial, pago e cancelado", () => {
  const rows = [
    {
      id: "1",
      centro_id: "A",
      status: "parcial",
      vencimento: "2026-10-07",
      valor: 100,
      valor_pago: 40,
      saldo: 60,
    },
    {
      id: "2",
      centro_id: "B",
      status: "aberto",
      vencimento: "2026-10-08",
      valor: 300,
      valor_pago: 0,
      saldo: 300,
    },
    {
      id: "3",
      centro_id: "A",
      status: "pago",
      vencimento: "2026-10-07",
      valor: 50,
      valor_pago: 50,
    },
    {
      id: "4",
      centro_id: "A",
      status: "cancelado",
      vencimento: "2026-10-06",
      valor: 500,
      valor_pago: 0,
    },
  ];
  expect(totaisTitulos(rows, "A", "2026-10-08")).toEqual({
    aberto: 60,
    vencido: 60,
    pago: 90,
    hoje: 0,
    futuros: 0,
  });
  expect(totaisTitulos(rows, "", "2026-10-08").aberto).toBe(360);
  expect(
    selecaoVisivel(
      ["1", "2", "3", "4"],
      rows.filter((r) => r.centro_id === "A"),
    ),
  ).toEqual(["1"]);
});

test("calendário financeiro conserva São Paulo e cruza meses/anos sem deslocar vencimento", () => {
  expect(hojeSaoPaulo(new Date("2026-10-09T01:30:00Z"))).toBe("2026-10-08");
  expect(deslocarDataISO("2026-12-31", 1)).toBe("2027-01-01");
  expect(deslocarDataISO("2028-02-28", 1)).toBe("2028-02-29");
  expect(deslocarDataISO("2026-10-08", -7)).toBe("2026-10-01");
});

test("parcela vencida parcialmente recebida aparece nos filtros e saldo inclui encargos", () => {
  const row = {
    status: "parcial",
    status_efetivo: "vencido_parcial",
    valor: 100,
    valor_pago: 40,
    juros: 10,
    multa: 2,
    desconto: 5,
  };
  expect(tituloNoStatus(row, "vencido")).toBe(true);
  expect(tituloNoStatus(row, "parcial")).toBe(true);
  expect(tituloNoStatus(row, "pago")).toBe(false);
  expect(saldoTitulo(row)).toBe(67);
  expect(saldoTitulo({ ...row, saldo: 65 })).toBe(65);
});
