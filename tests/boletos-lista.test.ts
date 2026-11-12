import { expect, test } from "bun:test";
import {
  alteracoesVencimentoConfirmadas,
  dataBoleto,
  filtrarBoletos,
  filtrosIniciaisBoletos,
  boletoCancelado,
  periodoBoletosInvalido,
  ordenarBoletos,
  cancelamentoBoletoPendente,
} from "../src/lib/boletos-lista";

const rows = [
  {
    id: "1",
    cliente_id: "a",
    status: "liquidado",
    data_emissao: "2026-10-01",
    vencimento: "2026-10-20",
    data_liquidacao: "2026-10-22",
    valor: 100,
  },
  {
    id: "2",
    cliente_id: "b",
    status: "registrado",
    data_emissao: "2026-10-02",
    vencimento: "2026-10-25",
    data_liquidacao: null,
    valor: 200,
  },
  {
    id: "3",
    cliente_id: "a",
    status: "liquidado",
    data_emissao: "2026-09-30",
    vencimento: "2026-10-20",
    data_liquidacao: "2026-10-21",
    valor: 300,
  },
];
const nome = (id: unknown) => (id === "a" ? "João Construções" : "Ferragens");
test("liquidação até exclui boletos sem data de liquidação e inclui o limite", () => {
  expect(filtrarBoletos(rows, { liquidacao_ate: "2026-10-21" }, nome).map((r) => r.id)).toEqual([
    "3",
  ]);
});
test("combina cliente, emissão, vencimento e liquidação, com limites inclusivos", () => {
  expect(
    filtrarBoletos(
      rows,
      {
        cliente: "a",
        emissao_de: "2026-10-01",
        emissao_ate: "2026-10-01",
        de: "2026-10-20",
        ate: "2026-10-20",
        liquidacao_de: "2026-10-22",
        liquidacao_ate: "2026-10-22",
      },
      nome,
    ).map((r) => r.id),
  ).toEqual(["1"]);
});
test("períodos invertidos não retornam resultados enganosos", () => {
  expect(
    periodoBoletosInvalido({ liquidacao_de: "2026-10-23", liquidacao_ate: "2026-10-21" }),
  ).toBe(true);
  expect(filtrarBoletos(rows, { de: "2026-10-30", ate: "2026-10-01" }, nome)).toEqual([]);
});
test("busca por nome ignora acentos e preserva filtro por situação e valor", () => {
  expect(
    filtrarBoletos(rows, { busca: "joao", status: "liquidado", max: "150" }, nome).map((r) => r.id),
  ).toEqual(["1"]);
});
test("limpar os filtros mantém todos os boletos recebidos e não altera a coleção", () => {
  expect(filtrarBoletos(rows, {}, nome)).toEqual(rows);
  expect(rows.length).toBe(3);
});
test("datas SQL mantêm o dia e valores ausentes ou impossíveis não viram datas", () => {
  expect(dataBoleto("2026-10-01")).toBe("2026-10-01");
  for (const value of [null, "", "2026-02-30", "2026-10-01T00:00:00Z"])
    expect(dataBoleto(value)).toBe("");
});

test("ordena emissão e vencimento em ambos os sentidos, sem alterar a coleção original", () => {
  const ids = (ordem: string) => ordenarBoletos(rows, ordem).map((r) => r.id);
  expect(ids("emissao_asc")).toEqual(["3", "1", "2"]);
  expect(ids("emissao_desc")).toEqual(["2", "1", "3"]);
  expect(ids("vencimento_asc")).toEqual(["1", "3", "2"]);
  expect(ids("")).toEqual(["1", "3", "2"]);
  expect(ids("desconhecida")).toEqual(["1", "3", "2"]);
  expect(ids("vencimento_desc")).toEqual(["2", "1", "3"]);
  expect(rows.map((r) => r.id)).toEqual(["1", "2", "3"]);
});
test("datas ausentes ficam no fim nos dois sentidos e ordenar mantém os filtros", () => {
  for (const ordem of ["emissao_asc", "emissao_desc", "vencimento_asc", "vencimento_desc", ""])
    expect(
      ordenarBoletos([...rows, { id: "0", data_emissao: null, vencimento: null }], ordem).at(-1)
        ?.id,
    ).toBe("0");
  expect(
    ordenarBoletos(filtrarBoletos(rows, { cliente: "a" }, nome), "emissao_asc").map((r) => r.id),
  ).toEqual(["3", "1"]);
});
test("cancelamento pendente não é confundido com baixa ou liquidação", () => {
  expect(
    cancelamentoBoletoPendente({
      status: "registrado",
      retorno: { cancelamento_sicredi_pendente: true },
    }),
  ).toBe(true);
  for (const status of ["liquidado", "baixado", "cancelado"])
    expect(
      cancelamentoBoletoPendente({ status, retorno: { cancelamento_sicredi_pendente: true } }),
    ).toBe(false);
});

test("tags mostram apenas vencimentos confirmados, em ordem e sem confundir solicitação pendente", () => {
  const base = {
    id: "a",
    vencimento_anterior: "2026-11-28",
    vencimento_novo: "2026-12-01",
    updated_at: "2026-10-29T12:00:00Z",
  };
  const alteracoes_vencimento = [
    ...["pendente", "enviado", "incerto", "rejeitado"].map((estado) => ({ ...base, estado })),
    { ...base, estado: "confirmado" },
    {
      ...base,
      id: "b",
      estado: "confirmado",
      vencimento_anterior: "2026-12-01",
      vencimento_novo: "2026-12-05",
      updated_at: "2026-10-30T12:00:00Z",
    },
    null,
    { ...base, id: "invalida", estado: "confirmado", vencimento_novo: "2026-02-30" },
    { ...base, id: "igual", estado: "confirmado", vencimento_novo: base.vencimento_anterior },
  ];
  const result = alteracoesVencimentoConfirmadas({
    alteracoes_vencimento,
    vencimento_solicitado: "2026-12-10",
  });
  expect(result.map((r) => r.id)).toEqual(["b", "a"]);
  expect(result[1]).toMatchObject({ anterior: "2026-11-28", novo: "2026-12-01" });
  expect(alteracoesVencimentoConfirmadas({})).toEqual([]);
  expect(
    alteracoesVencimentoConfirmadas({ alteracoes_vencimento: { estado: "confirmado" } }),
  ).toEqual([]);
});

test("tag de vencido respeita calendário e retorno, sem marcar boletos pagos ou cancelados", async () => {
  const { boletoVencido } = await import("../src/lib/boletos-lista");
  const boleto = { status: "registrado", vencimento: "2026-11-04" };
  expect(boletoVencido(boleto, "2026-11-05")).toBe(true);
  expect(boletoVencido({ ...boleto, vencimento: "2026-11-05" }, "2026-11-05")).toBe(false);
  expect(boletoVencido({ ...boleto, vencimento: "2026-11-06" }, "2026-11-05")).toBe(false);
  expect(
    boletoVencido(
      { ...boleto, vencimento: "2026-11-06", retorno: { situacao: "VENCIDO" } },
      "2026-11-05",
    ),
  ).toBe(true);
  for (const status of [
    "liquidado",
    "baixado",
    "cancelado",
    "erro",
    "pendente",
    "em_processamento",
  ])
    expect(boletoVencido({ ...boleto, status }, "2026-11-05")).toBe(false);
  expect(boletoVencido({ ...boleto, data_liquidacao: "2026-11-04" }, "2026-11-05")).toBe(false);
  expect(boletoVencido({ ...boleto, retorno: { situacao: "LIQUIDADO" } }, "2026-11-05")).toBe(
    false,
  );
  expect(boletoVencido({ ...boleto, vencimento: "inválido" }, "2026-11-05")).toBe(false);
  expect(
    filtrarBoletos(
      [
        { ...boleto, id: "atrasado", vencimento: "2000-01-01" },
        { ...boleto, id: "pago", status: "liquidado" },
      ],
      { status: "vencido" },
      () => "",
    ).map((b) => b["id"]),
  ).toEqual(["atrasado"]);
});

test("lista abre em aberto, inclui vencidos registrados e preserva atalhos para boletos liquidados", () => {
  const dados = [
    { id: "aberto", status: "registrado", vencimento: "2026-01-01" },
    { id: "pago", status: "liquidado", vencimento: "2026-01-01" },
    { id: "cancelado", status: "baixado" },
  ];
  const nomes = () => "";
  expect(
    filtrarBoletos(dados, filtrosIniciaisBoletos({ boleto: undefined }), nomes).map((b) => b.id),
  ).toEqual(["aberto"]);
  expect(
    filtrarBoletos(dados, filtrosIniciaisBoletos({ boleto: "pago" }), nomes).map((b) => b.id),
  ).toContain("pago");
  expect(filtrarBoletos(dados, { status: "liquidado" }, nomes).map((b) => b.id)).toEqual(["pago"]);
});

test("grupo cancelados reúne baixados e cancelados confirmados respeitando cliente e período", () => {
  const dados = [
    { id: "baixado", status: "baixado", cliente_id: "a", valor: 100, vencimento: "2026-11-15" },
    { id: "cancelado", status: "cancelado", cliente_id: "a", valor: 200, vencimento: "2026-11-20" },
    {
      id: "outro-cliente",
      status: "baixado",
      cliente_id: "b",
      valor: 300,
      vencimento: "2026-11-20",
    },
    {
      id: "solicitado",
      status: "registrado",
      cliente_id: "a",
      valor: 400,
      vencimento: "2026-11-15",
      retorno: { cancelamento_sicredi_pendente: true },
    },
    { id: "pago", status: "liquidado", cliente_id: "a", valor: 500, vencimento: "2026-11-15" },
  ];
  const cancelados = filtrarBoletos(
    dados,
    { status: "cancelados", cliente: "a", de: "2026-11-01", ate: "2026-11-30" },
    () => "",
  );
  expect(cancelados.map((b) => b.id)).toEqual(["baixado", "cancelado"]);
  expect(cancelados.reduce((s, b) => s + Number(b.valor), 0)).toBe(300);
  expect(
    filtrarBoletos(dados, { status: "cancelados", cliente: "a", ate: "2026-11-16" }, () => "").map(
      (b) => b.id,
    ),
  ).toEqual(["baixado"]);
  expect(boletoCancelado(dados[3]!)).toBe(false);
  expect(
    filtrarBoletos(dados, { status: "baixado", cliente: "a" }, () => "").map((b) => b.id),
  ).toEqual(["baixado"]);
});

test("cartão acompanha liquidação sem confundir zero padrão com recebimento real", async () => {
  const { totalBoletosLiquidados, valorRecebidoBoleto } = await import("../src/lib/boletos-lista");
  const b = { valor: 50, valor_liquidado: 0, vencimento: "2026-11-14" };
  expect(totalBoletosLiquidados([{ ...b, status: "registrado" }])).toBe(0);
  const liquidado = { ...b, status: "liquidado" };
  expect(totalBoletosLiquidados([liquidado])).toBe(50);
  expect(valorRecebidoBoleto(liquidado)).toBeNull();
  expect(totalBoletosLiquidados([{ ...liquidado, valor_liquidado: 51.63 }])).toBe(51.63);
  expect(valorRecebidoBoleto({ ...liquidado, valor_liquidado: "51.63" })).toBe(51.63);
  for (const valor_liquidado of [undefined, null, 0, -1, "inválido"])
    expect(totalBoletosLiquidados([{ ...liquidado, valor_liquidado }])).toBe(50);
  expect(
    totalBoletosLiquidados([
      { ...b, status: "cancelado" },
      { ...b, status: "baixado" },
    ]),
  ).toBe(0);
  expect(
    totalBoletosLiquidados([
      { ...liquidado, valor: 0.1 },
      { ...liquidado, valor: 0.2 },
    ]),
  ).toBe(0.3);
});
