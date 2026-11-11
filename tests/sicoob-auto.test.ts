import { test, expect } from "bun:test";
import {
  executarSicoobAutomatico,
  diagnosticoPagamentoSicoob,
} from "../src/lib/server-sicoob-auto";

test("diagnóstico conserva somente nomes e escalares financeiros, sem dados pessoais ou segredo", () => {
  const d = diagnosticoPagamentoSicoob({
    valorPago: 50,
    dataPagamento: "2026-11-11",
    pagador: { nome: "PESSOA" },
    access_token: "SEGREDO",
    valorTexto: "CPF 123",
  });
  expect(d.valores).toEqual({ valorPago: 50, dataPagamento: "2026-11-11" });
  expect(JSON.stringify(d)).not.toContain("PESSOA");
  expect(JSON.stringify(d)).not.toContain("SEGREDO");
  expect(JSON.stringify(d)).not.toContain("CPF 123");
});
test("403 é reagendado sem afirmar pagamento nem alterar status confirmado", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    calls.push({ name, args });
    return (
      name.includes("reservar")
        ? {
            lease: "l",
            itens: [{ id: "b", centro_id: "c", actor: "a", nosso_numero: "3849", versao: 1 }],
          }
        : null
    ) as T;
  };
  await executarSicoobAutomatico("segredo", rpc, async () => {
    throw Error("HTTP_403");
  });
  expect(calls[1]?.args["_erro"]).toBe("HTTP_403");
  expect(calls[1]?.args["_banco"]).toBeNull();
  expect(calls.map((c) => c.name)).toEqual([
    "sicoob_auto_reservar_358",
    "sicoob_auto_finalizar_358",
  ]);
});
test("fim do orçamento adia sem acessar banco; persistência com falha aborta", async () => {
  let reads = 0,
    tick = 0;
  const rpc = async <T>(name: string): Promise<T> =>
    (name.includes("reservar") ? { lease: "l", itens: [{ id: "b" }] } : null) as T;
  await executarSicoobAutomatico(
    "s",
    rpc,
    async () => {
      reads++;
      return {};
    },
    () => (tick++ === 0 ? 0 : 50000),
  );
  expect(reads).toBe(0);
  await expect(
    executarSicoobAutomatico(
      "s",
      async <T>(name: string): Promise<T> => {
        if (name.includes("finalizar")) throw Error("DB");
        return { lease: "l", itens: [{ id: "b" }] } as T;
      },
      async () => ({}),
    ),
  ).rejects.toThrow("DB");
});

test("retorno liquidado é encaminhado para sincronização sem criar dados de baixa financeira", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    calls.push({ name, args });
    return (
      name.includes("reservar") ? { lease: "l", itens: [{ id: "b", nosso_numero: "3849" }] } : null
    ) as T;
  };
  await executarSicoobAutomatico("s", rpc, async () => ({
    situacaoBoleto: "Liquidado",
    nossoNumero: 3849,
    numeroCliente: 4163036,
    codigoModalidade: 1,
    seuNumero: "original",
    valor: 50,
    dataVencimento: "2026-11-14",
    valorAbatimento: 0,
    tipoDesconto: 0,
    linhaDigitavel: "756" + "0".repeat(44),
    codigoBarras: "756" + "0".repeat(41),
  }));
  expect((calls[1]?.args["_banco"] as Record<string, unknown>)["situacao"]).toBe("LIQUIDADO");
  expect(calls[1]?.args["_erro"]).toBeNull();
  expect(calls.map((c) => c.name)).toEqual([
    "sicoob_auto_reservar_358",
    "sicoob_auto_finalizar_358",
  ]);
  expect(calls[1]?.args).not.toHaveProperty("_valorPago");
});
