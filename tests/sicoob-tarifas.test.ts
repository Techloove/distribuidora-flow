import { expect, test } from "bun:test";
import {
  movimentosTarifasSicoob,
  referenciaBoletoSicoob,
  resumoTarifasSicoob,
} from "../src/lib/sicoob-tarifas";
import { atenderTarifasSicoob, executarTarifasSicoob } from "../src/lib/server-sicoob-tarifas";
import { hojeSaoPaulo } from "../src/lib/painel-trabalho";
test("referência explícita, sem transformar documento bancário em nosso número", () => {
  expect(referenciaBoletoSicoob("TARIFA COBRANÇA", "NOSSO NÚMERO: 000123")).toBe("000123");
  expect(referenciaBoletoSicoob("TARIFA COBRANÇA", "", 123)).toBe("123");
  expect(referenciaBoletoSicoob("TARIFA COBRANÇA", "Documento 000123")).toBe("");
  expect(referenciaBoletoSicoob("Nosso número 123", "Nosso número 456")).toBe("");
  const r = movimentosTarifasSicoob({
    transacoes: [
      {
        transactionId: "evt123",
        tipo: "DÉBITO",
        valor: "1,02",
        data: "11/11/2026",
        numeroDocumento: "12345",
        descricao: "TARIFA COBRANÇA",
        cpfCnpj: "PRIVADO",
      },
    ],
  });
  expect(r[0]).toMatchObject({
    id: "evt123",
    tipo: "DEBITO",
    valor: 1.02,
    data: "2026-11-11",
    nosso_numero: "",
  });
  expect(JSON.stringify(r)).not.toContain("PRIVADO");
});
test("datas com horário são convertidas para Brasília; retorno ausente não é extrato vazio", () => {
  expect(
    movimentosTarifasSicoob({
      resultado: {
        transacoes: [
          { data: "2026-11-11T01:00:00Z", nossoNumero: "12345", descricao: "TARIFA TITULO" },
        ],
      },
    })[0],
  ).toMatchObject({ data: "2026-11-10", nosso_numero: "12345" });
  expect(() => movimentosTarifasSicoob({})).toThrow();
});
test("agendamento exige método e segredo privado antes de qualquer acesso", async () => {
  expect((await atenderTarifasSicoob(new Request("https://erp/api/sicoob/tarifas"))).status).toBe(
    405,
  );
  expect(
    (await atenderTarifasSicoob(new Request("https://erp/api/sicoob/tarifas", { method: "POST" })))
      .status,
  ).toBe(401);
  expect(
    (
      await atenderTarifasSicoob(
        new Request("https://erp/api/sicoob/tarifas", {
          method: "POST",
          headers: { "X-Sicoob-Automacao": "invalido" },
        }),
      )
    ).status,
  ).toBe(401);
});
test("worker finaliza lote completo sem valores do navegador e não lança após falha de consulta", async () => {
  const hoje = hojeSaoPaulo(),
    calls: { nome: string; args: Record<string, unknown> }[] = [];
  const r = {
    lease: "fixture-lease",
    mes: hoje.slice(0, 7),
    inicio: hoje,
    fim: hoje,
    clientId: "client",
    numeroConta: "123",
    certificado: { pfx: "falso" },
  };
  const rpc = async <T>(nome: string, args: Record<string, unknown>) => {
    calls.push({ nome, args });
    return { lancados: 1, ignorados: 0, conferir: 0 } as T;
  };
  expect(
    await executarTarifasSicoob(r, rpc, async () => ({
      transacoes: [
        {
          transactionId: "event-123",
          tipo: "DEBITO",
          data: hoje,
          valor: "1.02",
          descricao: "TARIFA COBRANCA",
          nossoNumero: "456",
        },
      ],
    })),
  ).toMatchObject({ lancados: 1 });
  expect(calls[0]!.nome).toBe("sicoob_tarifas_finalizar_355");
  expect(calls[0]!.args["_movimentos"]).toMatchObject([{ nosso_numero: "456", valor: 1.02 }]);
  calls.length = 0;
  await expect(
    executarTarifasSicoob(r, rpc, async () => {
      throw Error("DADO_PRIVADO");
    }),
  ).rejects.toThrow("não contabilizadas");
  expect(calls).toHaveLength(1);
  expect(calls[0]!.args).toEqual({ _lease: "fixture-lease", _erro: "CONSULTA_FALHOU" });
  calls.length = 0;
  expect(await executarTarifasSicoob({}, rpc)).toMatchObject({ semConsulta: true });
  expect(calls).toHaveLength(0);
});

test("LIQUI contabilizado não soma outra vez o débito genérico ou agrupado", () => {
  const base = {
    fonte_361: "liqui",
    natureza_361: "liquidacao",
    valor: 1.44,
    estado: "lancado",
    movimento_id: "m1",
    conta_id: "sicoob",
    categoria_id: "tarifa",
    data_lancamento: "2026-11-11",
    movimento: {
      status: "ativo",
      tipo: "saida",
      valor: 1.44,
      conta_id: "sicoob",
      categoria_id: "tarifa",
      data: "2026-11-11",
    },
  };
  expect(resumoTarifasSicoob([], 1.44)).toMatchObject({ valor: 1.44, contabilizada: false });
  expect(resumoTarifasSicoob([base], 1.44)).toMatchObject({
    valor: 1.44,
    contabilizada: true,
    conferir: false,
  });
  expect(
    resumoTarifasSicoob(
      [
        base,
        { fonte_361: "extrato", natureza_361: "incerta", estado: "conferir_liqui", valor: 2.88 },
      ],
      1.44,
    ),
  ).toMatchObject({ valor: 1.44, contabilizada: true, conferir: true });
  const outra = {
    ...base,
    fonte_361: "extrato",
    natureza_361: "outra",
    valor: 0.96,
    movimento: { ...base.movimento, valor: 0.96 },
  };
  expect(resumoTarifasSicoob([base, outra], 1.44)).toMatchObject({
    valor: 2.4,
    contabilizada: true,
    origem: "LIQUI + extrato",
  });
  expect(
    resumoTarifasSicoob([{ ...base, movimento: { ...base.movimento, status: "estornado" } }], 1.44),
  ).toMatchObject({ contabilizada: false, conferir: true });
  expect(
    resumoTarifasSicoob([{ ...base, movimento: { ...base.movimento, conta_id: "sicredi" } }], 1.44),
  ).toMatchObject({ contabilizada: false, conferir: true });
  expect(resumoTarifasSicoob([{ ...base, estado: "retorno_divergente" }], 1.55)).toMatchObject({
    valor: 1.55,
    contabilizada: false,
    conferir: true,
  });
});
