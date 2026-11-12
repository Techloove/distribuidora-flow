import { expect, test } from "bun:test";
import {
  confirmarRespostaEmissaoSicoob,
  consultarEmissaoPendenteSicoob,
} from "../src/lib/sicoob-confirmacao-emissao";
import { condicoesSicoob, camposDivergentesBoletoSicoob } from "../src/lib/sicoob-api";
const raw = {
  numeroCliente: 12345,
  codigoModalidade: 1,
  numeroContaCorrente: 67890,
  nossoNumero: 3850,
  seuNumero: "Teste2/1",
  identificacaoBoletoEmpresa: "empresa-erp",
  valor: 25,
  dataVencimento: "2026-11-18",
  valorAbatimento: 0,
  tipoDesconto: 0,
  situacaoBoleto: "Em Aberto",
  linhaDigitavel: "756" + "0".repeat(44),
  codigoBarras: "756" + "0".repeat(41),
};
const cfg = { numero_cliente: 12345, numero_conta: 67890 },
  b = { seu_numero: "Teste2/1", valor: 25 };
test("resposta inicial divergente é recuperada por consulta sem aceitar a conta errada", async () => {
  const aceitos: unknown[] = [];
  const leituras: string[] = [];
  const aceitar = async (r: Record<string, unknown>) => {
    const c = condicoesSicoob(r);
    if (camposDivergentesBoletoSicoob(c, b, cfg, r).length) throw Error("Divergente");
    aceitos.push(c);
    return c;
  };
  const resultado = await confirmarRespostaEmissaoSicoob(
    { ...raw, numeroContaCorrente: 0 },
    aceitar,
    async (nn) => {
      leituras.push(nn);
      return aceitar(raw);
    },
  );
  expect(resultado.nossoNumero).toBe("3850");
  expect(leituras).toEqual(["3850"]);
  expect(aceitos).toHaveLength(1);
  await expect(
    confirmarRespostaEmissaoSicoob({ ...raw, valor: 50 }, aceitar, async () =>
      aceitar({ ...raw, valor: 50 }),
    ),
  ).rejects.toThrow("Divergente");
  expect(aceitos).toHaveLength(1);
});
test("resposta completa não consulta outra vez; número ausente ou zero nunca é inventado", async () => {
  let consultas = 0;
  expect(
    await confirmarRespostaEmissaoSicoob(
      raw,
      async () => "ok",
      async () => {
        consultas++;
        return "get";
      },
    ),
  ).toBe("ok");
  for (const nn of [undefined, 0, -1, "abc"]) {
    await expect(
      confirmarRespostaEmissaoSicoob(
        { ...raw, nossoNumero: nn },
        async () => {
          throw Error("pendente");
        },
        async () => {
          consultas++;
          return "get";
        },
      ),
    ).rejects.toThrow("pendente");
  }
  expect(consultas).toBe(0);
});
test("recupera pelo documento e identificador técnico, com janelas válidas e somente GET", async () => {
  const paths: string[] = [];
  const result = await consultarEmissaoPendenteSicoob(
    async (path) => {
      paths.push(path);
      if (path.startsWith("/pagadores/"))
        return {
          status: 200,
          json: {
            resultado:
              paths.length === 1
                ? [{ ...raw, identificacaoBoletoEmpresa: "empresa-antiga" }, raw]
                : [],
          },
        };
      return { status: 200, json: { resultado: raw } };
    },
    12345,
    "11122233300",
    "2026-11-18",
    "Teste2/1",
    null,
    "empresa-erp",
  );
  expect(result).toEqual(raw);
  expect(paths).toHaveLength(3);
  expect(paths.filter((p) => p.startsWith("/boletos?"))).toHaveLength(1);
  expect(paths.join()).not.toContain("/baixar");
});
test("referência reutilizada não permite vincular um boleto antigo nem resultado ambíguo", async () => {
  await expect(
    consultarEmissaoPendenteSicoob(
      async (path) => ({
        status: 200,
        json: { resultado: path.startsWith("/pagadores/") ? [raw] : raw },
      }),
      12345,
      "11122233300",
      "2026-11-18",
      "Teste2/1",
      null,
      "empresa-erp",
    ),
  ).rejects.toThrow("única");
  let n = 0;
  await expect(
    consultarEmissaoPendenteSicoob(
      async (path) =>
        path.startsWith("/pagadores/")
          ? {
              status: 200,
              json: {
                resultado: n++ === 0 ? [{ ...raw, identificacaoBoletoEmpresa: undefined }] : [],
              },
            }
          : {
              status: 200,
              json: { resultado: { ...raw, identificacaoBoletoEmpresa: "empresa-antiga" } },
            },
      12345,
      "11122233300",
      "2026-11-18",
      "Teste2/1",
      null,
      "empresa-erp",
    ),
  ).rejects.toThrow("empresa divergente");
});
