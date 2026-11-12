import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { registrosZipSicoob, normalizarLiquiSicoob } from "../src/lib/server-sicoob-liqui";
import {
  executarLiquidacoesSicoob,
  type JobLiquiSicoob,
} from "../src/lib/server-sicoob-liquidacoes";
const linha = {
  siglaMovimento: "LIQUI",
  numeroCliente: 123,
  numeroContaCorrente: 456,
  modalidade: 1,
  numeroTitulo: 3849,
  seuNumero: "origem",
  codigoBarras: "756" + "0".repeat(41),
  valorTitulo: 180,
  valorLiquido: 202.96,
  valorMora: 22.96,
  valorDesconto: 0,
  valorAbatimento: 0,
  valorTarifaMovimento: 1.94,
  dataLiquidacao: "2026-11-10T00:00:00-03:00",
  dataMovimentoLiquidacao: "2026-11-10T00:00:00-03:00",
};
function zip(v: unknown, nome = "retorno.json") {
  return execFileSync(
    "python3",
    [
      "-c",
      "import io,zipfile,sys,base64; b=io.BytesIO(); z=zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED); z.writestr(sys.argv[1],sys.stdin.read()); z.close(); print(base64.b64encode(b.getvalue()).decode())",
      nome,
    ],
    { input: JSON.stringify(v), encoding: "utf8" },
  ).trim();
}
test("LIQUI conserva valor, data, mora e tarifa separados, sem confundir líquido com crédito após tarifa", () => {
  const r = normalizarLiquiSicoob(linha, "2026-11-09", "2026-11-10");
  expect(r.valor).toBe(202.96);
  expect(r.mora).toBe(22.96);
  expect(r.tarifa).toBe(1.94);
  expect(r.data).toBe("2026-11-10");
  expect(
    normalizarLiquiSicoob(
      { ...linha, dataLiquidacao: "2026-11-09", dataMovimentoLiquidacao: "2026-11-10" },
      "2026-11-10",
      "2026-11-11",
    ).data,
  ).toBe("2026-11-09");
  expect(
    normalizarLiquiSicoob({ ...linha, valorTarifaMovimento: 0 }, "2026-11-09", "2026-11-10").chave,
  ).toBe(r.chave);
  for (const bad of [
    { valorLiquido: undefined },
    { dataLiquidacao: undefined },
    { valorLiquido: 201.02 },
    { valorMora: -1 },
    { siglaMovimento: "BAIXA" },
    { codigoBarras: "748" + "0".repeat(41) },
    { dataLiquidacao: "2026-11-10-lixo" },
  ])
    expect(() => normalizarLiquiSicoob({ ...linha, ...bad }, "2026-11-09", "2026-11-10")).toThrow();
  expect(() => normalizarLiquiSicoob(linha, "2026-11-11", "2026-11-12")).toThrow("FORA_PERIODO");
});
test("ZIP valida deflate, CRC, nomes, Base64 e limites, sem extrair arquivos", () => {
  const base = zip([linha]);
  expect(registrosZipSicoob(base)).toEqual([linha]);
  const bytes = Buffer.from(base, "base64");
  let central = -1;
  for (let i = 0; i < bytes.length - 4; i++)
    if (bytes.readUInt32LE(i) === 0x02014b50) {
      central = i;
      break;
    }
  const corrompido = Buffer.from(bytes);
  corrompido.writeUInt32LE(1, central + 16);
  expect(() => registrosZipSicoob(corrompido.toString("base64"))).toThrow("CRC");
  const grande = Buffer.from(bytes);
  grande.writeUInt32LE(20000001, central + 24);
  expect(() => registrosZipSicoob(grande.toString("base64"))).toThrow("LIMITE");
  expect(() => registrosZipSicoob(zip([linha], "../vazamento.json"))).toThrow();
  expect(() => registrosZipSicoob(base + "\n")).toThrow();
  expect(() => registrosZipSicoob(zip({ resultado: [] }))).toThrow();
});
const job: JobLiquiSicoob = {
  id: "j",
  lease: "l",
  centro_id: "c",
  actor: "a",
  versao: 1,
  numero_cliente: 123,
  numero_conta: 456,
  contrato: null,
  inicio: "2026-11-09",
  fim: "2026-11-10",
  estado: "solicitar",
  codigo: null,
  arquivos: [],
  feitos: [],
};
function deps(j: JobLiquiSicoob) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    calls.push({ name, args });
    return (
      name.includes("reservar")
        ? j
        : name.includes("identificar")
          ? [{ nossoNumero: "3849", seuNumero: "origem", codigoBarras: linha.codigoBarras }]
          : {}
    ) as T;
  };
  return { rpc, calls };
}
test("201 salva código antes de consultar, 204 apenas aguarda e 403 preserva estágio para repetição", async () => {
  const d = deps(job);
  let metodo = "";
  await executarLiquidacoesSicoob("s", d.rpc, async () => async (_p, m) => {
    metodo = m!;
    return { status: 201, json: { resultado: { codigoSolicitacao: 99 } } };
  });
  expect(metodo).toBe("POST");
  expect(d.calls[1]?.args["_acao"]).toBe("solicitacao");
  expect(d.calls[1]?.args["_dados"]).toEqual({ codigo: 99 });
  const e = deps({ ...job, estado: "aguardar", codigo: 99 });
  await executarLiquidacoesSicoob("s", e.rpc, async () => async () => ({ status: 204, json: {} }));
  expect(e.calls[1]?.args["_acao"]).toBe("aguardar");
  const f = deps(job);
  await expect(
    executarLiquidacoesSicoob("s", f.rpc, async () => async () => ({ status: 403, json: {} })),
  ).rejects.toThrow("HTTP_403");
  expect(f.calls[1]?.args["_acao"]).toBe("erro");
});
test("lista completa é exigida e cada arquivo é baixado uma vez; não chama emissão ou baixa bancária", async () => {
  const d = deps({ ...job, estado: "aguardar", codigo: 99 });
  await expect(
    executarLiquidacoesSicoob("s", d.rpc, async () => async () => ({
      status: 200,
      json: { resultado: { idArquivos: [1], quantidadeArquivo: 2 } },
    })),
  ).rejects.toThrow("LISTA_INVALIDA");
  const e = deps({ ...job, estado: "baixar", codigo: 99, arquivos: [1, 2], feitos: [1] });
  let path = "";
  await executarLiquidacoesSicoob("s", e.rpc, async () => async (p, m) => {
    path = p;
    expect(m).toBeUndefined();
    return { status: 200, json: { resultado: { arquivo: zip([linha]) } } };
  });
  expect(path).toContain("idArquivo=2");
  expect(e.calls[2]?.name).toBe("sicoob_liqui_arquivo_359");
  expect(e.calls[2]?.args["_arquivo"]).toBe(2);
  expect(e.calls.map((c) => c.name)).toEqual([
    "sicoob_liqui_reservar_359",
    "sicoob_liqui_identificar_360",
    "sicoob_liqui_arquivo_359",
  ]);
});

test("lista vazia sem confirmação de total zero continua aguardando, IDs textuais são normalizados", async () => {
  const d = deps({ ...job, estado: "aguardar", codigo: 99 });
  await executarLiquidacoesSicoob("s", d.rpc, async () => async () => ({
    status: 200,
    json: { resultado: { idArquivos: [], quantidadeArquivo: 0, quantidadeTotalRegistros: 100 } },
  }));
  expect(d.calls[1]?.args["_acao"]).toBe("aguardar");
  const e = deps({ ...job, estado: "aguardar", codigo: 99 });
  await executarLiquidacoesSicoob("s", e.rpc, async () => async () => ({
    status: 200,
    json: { resultado: { idArquivos: ["101", "102"], quantidadeArquivo: "2" } },
  }));
  expect(e.calls[1]?.args["_dados"]).toEqual({ ids: [101, 102] });
});

test("403 no download preserva motivo tratado, rastreio e etapa, sem corpo bruto ou nova solicitação", async () => {
  const d = deps({
    ...job,
    estado: "baixar",
    codigo: 223647729,
    arquivos: [100007494],
    feitos: [],
  });
  let chamadas = 0;
  await expect(
    executarLiquidacoesSicoob("s", d.rpc, async () => async (path, method) => {
      chamadas++;
      expect(path).toContain("codigoSolicitacao=223647729");
      expect(path).toContain("idArquivo=100007494");
      expect(method).toBeUndefined();
      return {
        status: 403,
        json: { message: "recusa", pagador: { nome: "NÃO EXPOR" } },
        motivo: "Sem permissão para download",
        rastreio: { "x-request-id": "req-123" },
      };
    }),
  ).rejects.toThrow("HTTP_403");
  expect(chamadas).toBe(1);
  expect(d.calls).toHaveLength(2);
  const diagnostico = (d.calls[1]?.args["_dados"] as Record<string, unknown>)[
    "diagnostico"
  ] as Record<string, unknown>;
  expect(diagnostico["respostaHttp"]).toEqual({
    etapa: "baixar",
    metodo: "GET",
    recurso: "/boletos/movimentacoes/download",
    status: 403,
    motivo: "Sem permissão para download",
    rastreio: { "x-request-id": "req-123" },
    camposResposta: ["message", "pagador"],
  });
  expect(JSON.stringify(diagnostico)).not.toContain("NÃO EXPOR");
});

test("registro externo com texto livre e IDs incompletos não bloqueia recebimento ERP", async () => {
  const d = deps({ ...job, estado: "baixar", codigo: 99, arquivos: [1], feitos: [] });
  const antigo = {
    ...linha,
    numeroTitulo: null,
    numeroCliente: "fora do ERP",
    modalidade: null,
    seuNumero: "NF antiga – venda 123",
    codigoBarras: "756" + "9".repeat(41),
    valorLiquido: "formato externo",
  };
  await executarLiquidacoesSicoob("s", d.rpc, async () => async () => ({
    status: 200,
    json: { resultado: { arquivo: zip([antigo, linha]) } },
  }));
  const identificar = d.calls.find((c) => c.name === "sicoob_liqui_identificar_360");
  expect(identificar?.args["_referencias"]).toEqual([
    { seuNumero: "NF antiga – venda 123", codigoBarras: antigo.codigoBarras },
    { seuNumero: "origem", codigoBarras: linha.codigoBarras },
  ]);
  const aplicar = d.calls.find((c) => c.name === "sicoob_liqui_arquivo_359");
  const registros = aplicar?.args["_registros"] as Record<string, unknown>[];
  expect(registros).toHaveLength(1);
  expect(registros[0]?.["nossoNumero"]).toBe("3849");
});
test("candidato ERP com identificador inválido continua bloqueado e informa o campo", async () => {
  const d = deps({ ...job, estado: "baixar", codigo: 99, arquivos: [1], feitos: [] });
  await expect(
    executarLiquidacoesSicoob("s", d.rpc, async () => async () => ({
      status: 200,
      json: { resultado: { arquivo: zip([{ ...linha, numeroContaCorrente: "inválido" }]) } },
    })),
  ).rejects.toThrow("LIQUI_IDENTIFICACAO_INVALIDA_CONTA");
  expect(d.calls.some((c) => c.name === "sicoob_liqui_arquivo_359")).toBe(false);
  expect(d.calls.at(-1)?.args["_acao"]).toBe("erro");
});

test("documento/parcela textual mantém a conciliação sem aceitar caracteres de controle", () => {
  expect(
    normalizarLiquiSicoob({ ...linha, seuNumero: "NF Açúcar/1" }, "2026-11-10", "2026-11-11")
      .seuNumero,
  ).toBe("NF Açúcar/1");
  expect(() =>
    normalizarLiquiSicoob({ ...linha, seuNumero: "NF\u00001/1" }, "2026-11-10", "2026-11-11"),
  ).toThrow("LIQUI_TITULO_INVALIDO");
});

test("400/5002 sem registros conclui somente o status, sem arquivo ou recebimento inventado", async () => {
  const d = deps({ ...job, estado: "aguardar", codigo: 223733787 });
  const paths: string[] = [];
  const retorno = {
    status: 400,
    json: {
      mensagens: [{ codigo: "5002", mensagem: "Solicitação não retornou nenhum registro." }],
    },
  };
  expect(
    await executarLiquidacoesSicoob("s", d.rpc, async () => async (path, method) => {
      paths.push(path);
      expect(method).toBeUndefined();
      return retorno;
    }),
  ).toEqual({ semRegistros: true });
  expect(paths).toHaveLength(1);
  expect(paths[0]).toContain("codigoSolicitacao=223733787");
  expect(d.calls.map((c) => c.name)).toEqual([
    "sicoob_liqui_reservar_359",
    "sicoob_liqui_etapa_359",
  ]);
  expect(d.calls[1]?.args["_acao"]).toBe("arquivos");
  expect(d.calls[1]?.args["_dados"]).toEqual({ ids: [] });
  for (const [estado, codigo, arquivos] of [
    ["solicitar", null, []],
    ["baixar", 99, [1]],
  ] as const) {
    const x = deps({ ...job, estado, codigo, arquivos: [...arquivos] });
    await expect(
      executarLiquidacoesSicoob("s", x.rpc, async () => async () => retorno),
    ).rejects.toThrow("HTTP_400");
    expect(x.calls[1]?.args["_acao"]).toBe("erro");
  }
});
test("mesmo 5002 com período inválido ou mensagem conflitante continua erro", async () => {
  for (const mensagens of [
    [{ codigo: "5002", mensagem: "O período informado não pode ser maior que 35 dias." }],
    [{ codigo: "9999", mensagem: "Solicitação não retornou nenhum registro." }],
    [
      { codigo: "5002", mensagem: "Solicitação não retornou nenhum registro." },
      { codigo: "403", mensagem: "Acesso negado" },
    ],
    [],
  ]) {
    const d = deps({ ...job, estado: "aguardar", codigo: 99 });
    await expect(
      executarLiquidacoesSicoob("s", d.rpc, async () => async () => ({
        status: 400,
        json: { mensagens },
      })),
    ).rejects.toThrow("HTTP_400");
    expect(d.calls[1]?.args["_acao"]).toBe("erro");
  }
});
