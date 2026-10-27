import { expect, test } from "bun:test";
import {
  lerFrancesinhaCompleta,
  paginaFrancesinha,
  tarifaIdentificada,
} from "../src/lib/sicredi-francesinha";
import { executarTarifasSicredi, atenderTarifasSicredi } from "../src/lib/server-sicredi-tarifas";
import { agruparTarifasApi } from "../src/lib/boletos-lista";
const c = { cooperativa: "0165", posto: "02", beneficiario: "00623" },
  dia = "2026-10-22";
const movimento = {
  agencia: "0165",
  posto: "02",
  beneficiario: "00623",
  nossoNumero: "600000228",
  dataLancamento: dia,
  tipoMovimento: "DEBITO",
  descMovimento: "TARIFA DE COBRANCA",
  valorMovimento: 1.63,
  nomePagador: "DADO PRIVADO",
  identPagador: "DOCUMENTO PRIVADO",
};
const page = (items = [movimento], pagina = 0, totalPaginas = 1, total = items.length) => ({
  resultado: items,
  pagina,
  totalPaginas,
  total,
});
test("Francesinha extrai apenas campos documentados do débito, sem dados pessoais", () => {
  const p = paginaFrancesinha(page(), c, dia, 0);
  expect(p.movimentos).toEqual([
    { ...c, dia, nosso_numero: "600000228", descricao: "TARIFA DE COBRANCA", valor: 1.63 },
  ]);
  expect(JSON.stringify(p)).not.toContain("PRIVADO");
  expect(tarifaIdentificada("TARIFA DE COBRANCA")).toBe(true);
  expect(tarifaIdentificada("LIQUIDACAO COMPE")).toBe(false);
  expect(tarifaIdentificada("OUTRO DEBITO")).toBe(false);
});
test("não atribui débito de outro convênio, dia, crédito ou valor inválido", () => {
  for (const patch of [
    { agencia: "9999" },
    { posto: "03" },
    { beneficiario: "99999" },
    { dataLancamento: "2026-10-23" },
    { tipoMovimento: "CREDITO" },
    { valorMovimento: -1 },
    { valorMovimento: "NaN" },
    { valorMovimento: 1.234 },
    { nossoNumero: "abc" },
  ]) {
    expect(() =>
      paginaFrancesinha(page([{ ...movimento, ...patch }] as (typeof movimento)[]), c, dia, 0),
    ).toThrow("RETORNO_INVALIDO");
  }
});
test("data de saída aceita os dois formatos apresentados pelo manual e total zero não vira tarifa", () => {
  expect(
    paginaFrancesinha(
      page([{ ...movimento, dataLancamento: "2026/10/22", valorMovimento: 0 }]),
      c,
      dia,
      0,
    ).movimentos,
  ).toEqual([]);
  expect(paginaFrancesinha(page([], 0, 0, 0), c, dia, 0).movimentos).toEqual([]);
});
test("só entrega o dia completo depois de ler todas as páginas", async () => {
  const result = await lerFrancesinhaCompleta(c, dia, async (p) =>
    page([{ ...movimento, nossoNumero: p ? "600000229" : "600000228" }], p, 2, 2),
  );
  expect(result).toHaveLength(2);
  await expect(
    lerFrancesinhaCompleta(c, dia, async (p) => page([movimento], p, 2, p ? 3 : 2)),
  ).rejects.toThrow("RETORNO_INVALIDO");
  await expect(
    lerFrancesinhaCompleta(c, dia, async () => page([movimento], 0, 1, 2)),
  ).rejects.toThrow("RETORNO_INVALIDO");
});
test("agregação separa tarifa identificada de outros débitos e soma centavos por data", () => {
  const result = agruparTarifasApi([
    {
      boleto_id: "a",
      data_lancamento: dia,
      tarifa_total: "1.63",
      outros_debitos: 1,
      debitos: [
        { descricao: "TARIFA COBRANCA", valor: 1.63 },
        { descricao: "OUTRO DEBITO", valor: 2 },
      ],
    },
    {
      boleto_id: "a",
      data_lancamento: "2026-10-23",
      tarifa_total: "0.10",
      outros_debitos: 0,
      debitos: [{ descricao: "TARIFA MANUTENCAO", valor: 0.1 }],
    },
  ]).get("a");
  expect(result?.valor).toBe(1.73);
  expect(result?.outros).toBe(1);
  expect(result?.itens).toHaveLength(3);
});
const banco = {
  ...c,
  base: "https://fixture.sicredi.test",
  apiKey: "CHAVE",
  username: "006230165",
  password: "SEGREDO",
  ambiente: "producao",
};
function fixture() {
  const writes: Record<string, unknown>[] = [];
  return {
    writes,
    io: {
      rpc: async <T>(name: string, args: Record<string, unknown>) => {
        if (name.includes("reservar")) return { ...c, dia, lease: "lease" } as T;
        writes.push(args);
        return 1 as T;
      },
      config: async () => banco,
      consultar: async () => page(),
    },
  };
}
test("orquestrador persiste apenas após retorno completo e não chama liquidação ou despesa", async () => {
  const f = fixture();
  expect(await executarTarifasSicredi("secret", f.io)).toEqual({ boletos: 1 });
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]?.["_movimentos"]).toHaveLength(1);
  expect(JSON.stringify(f.writes)).not.toContain("SEGREDO");
});
test("falha na segunda página registra apenas erro, preservando snapshot anterior", async () => {
  const f = fixture();
  await expect(
    executarTarifasSicredi("secret", {
      ...f.io,
      consultar: async (_c, _dia, p) => {
        if (p) throw new Error("Authorization: SEGREDO");
        return page([movimento], 0, 2, 2);
      },
    }),
  ).rejects.toThrow("CONSULTA_FALHOU");
  expect(f.writes).toEqual([{ _lease: "lease", _erro: "CONSULTA_FALHOU" }]);
});
test("convênio alterado ou sandbox não permite consultar nem persistir débitos", async () => {
  const f = fixture();
  let calls = 0;
  await expect(
    executarTarifasSicredi("secret", {
      ...f.io,
      config: async () => ({ ...banco, ambiente: "homologacao" }),
      consultar: async () => {
        calls++;
        return page();
      },
    }),
  ).rejects.toThrow("CONVENIO_DIVERGENTE");
  expect(calls).toBe(0);
  expect(f.writes[0]?.["_movimentos"]).toBeUndefined();
});
test("endpoint de tarifas exige POST e segredo privado, sem acesso pelo navegador", async () => {
  expect((await atenderTarifasSicredi(new Request("https://erp/api/sicredi/tarifas"))).status).toBe(
    405,
  );
  expect(
    (
      await atenderTarifasSicredi(
        new Request("https://erp/api/sicredi/tarifas", { method: "POST" }),
      )
    ).status,
  ).toBe(401);
});

test("endpoint consulta a Francesinha com GET, parâmetros documentados e token privado", async () => {
  const originalFetch = globalThis.fetch;
  const keys = ["EXT_SUPABASE_URL", "EXT_SUPABASE_SERVICE_ROLE_KEY"] as const;
  const previous = keys.map((k) => process.env[k]);
  process.env.EXT_SUPABASE_URL = "https://fixture.supabase.test";
  process.env.EXT_SUPABASE_SERVICE_ROLE_KEY = "SERVICE_PRIVADO";
  const bancoCalls: { url: URL; init?: RequestInit }[] = [];
  let persisted: Record<string, unknown> | undefined;
  let formatoComHifen = false;
  let httpStatus = 200;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    let out: unknown;
    if (url.pathname.endsWith("sicredi_tarifas_reservar_280")) out = { ...c, dia, lease: "lease" };
    else if (url.pathname.endsWith("sicredi_config"))
      out = [
        {
          api_key: "API_PRIVADO",
          password: "SENHA_PRIVADA",
          username: "006230165",
          cooperativa: "0165",
          posto: "02",
          codigo_beneficiario: "00623",
          ambiente: "producao",
        },
      ];
    else if (url.pathname.endsWith("sicredi_token_reservar_224"))
      out = { access_token: "TOKEN_PRIVADO" };
    else if (url.pathname === "/cobranca/v1/cobranca-financeiro/movimentacoes/") {
      bancoCalls.push({ url, init });
      if (
        httpStatus !== 200 ||
        (formatoComHifen && url.searchParams.get("dataLancamento")?.includes("/"))
      )
        return new Response("Erro sem dados", { status: httpStatus !== 200 ? httpStatus : 400 });
      out = page();
    } else if (url.pathname.endsWith("sicredi_tarifas_finalizar_280")) {
      persisted = body;
      out = 1;
    } else throw new Error("Chamada inesperada");
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const response = await atenderTarifasSicredi(
      new Request("https://erp/api/sicredi/tarifas", {
        method: "POST",
        headers: { Authorization: `Bearer ${"a".repeat(64)}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(bancoCalls).toHaveLength(1);
    const call = bancoCalls[0]!;
    expect(call.init?.method ?? "GET").toBe("GET");
    expect(Object.fromEntries(call.url.searchParams)).toEqual({
      codigoBeneficiario: "00623",
      cooperativa: "0165",
      posto: "02",
      dataLancamento: "22/10/2026",
      tipoMovimento: "DEBITO",
      pagina: "0",
    });
    expect(new Headers(call.init?.headers).get("Authorization")).toBe("Bearer TOKEN_PRIVADO");
    expect(JSON.stringify(persisted)).not.toMatch(/PRIVAD|PRIVADO|SENHA|TOKEN/);
    expect(await response.json()).toEqual({ boletos: 1 });
    formatoComHifen = true;
    bancoCalls.length = 0;
    const request = () =>
      new Request("https://erp/api/sicredi/tarifas", {
        method: "POST",
        headers: { Authorization: `Bearer ${"a".repeat(64)}` },
      });
    expect((await atenderTarifasSicredi(request())).status).toBe(200);
    expect(bancoCalls.map((call) => call.url.searchParams.get("dataLancamento"))).toEqual([
      "22/10/2026",
      "22-10-2026",
    ]);
    bancoCalls.length = 0;
    httpStatus = 401;
    expect((await atenderTarifasSicredi(request())).status).toBe(503);
    expect(bancoCalls).toHaveLength(1);
    expect(persisted).toEqual({ _lease: "lease", _erro: "HTTP" });
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((k, i) => {
      if (previous[i] === undefined) delete process.env[k];
      else process.env[k] = previous[i];
    });
  }
});
