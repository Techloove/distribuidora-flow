import { expect, test } from "bun:test";
import {
  atenderSicrediAutomatico,
  executarConsultaAutomatica,
} from "../src/lib/server-sicredi-auto";
const boleto = {
  id: "b1",
  nosso_numero: "123",
  cooperativa: "0307",
  posto: "01",
  codigo_beneficiario: "29742",
  responsavel: "admin",
};
const config = { ...boleto, ambiente: "producao" };
function fixture(resposta: Record<string, unknown>) {
  const gravacoes: Record<string, unknown>[] = [];
  let chamadas = 0;
  return {
    gravacoes,
    get chamadas() {
      return chamadas;
    },
    io: {
      rpc: async <T>(name: string, args: Record<string, unknown>) => {
        if (name.includes("reservar")) return { lease: "lease", itens: [boleto] } as T;
        gravacoes.push(args);
        return args["_situacao"] as T;
      },
      config: async () => config,
      consultar: async () => {
        chamadas++;
        return resposta;
      },
    },
  };
}
test("consulta automática usa somente liquidação completa; não emite boletos", async () => {
  const f = fixture({
    situacao: "LIQUIDADO",
    dadosLiquidacao: { data: "2026-10-20", valor: 107, juros: 5, multa: 2 },
  });
  expect(await executarConsultaAutomatica("secret", f.io)).toEqual({
    consultados: 1,
    processados: 1,
  });
  expect(f.gravacoes[0]?.["_dados"]).toMatchObject({ valor: 107, juros: 5, multa: 2 });
  const incompleto = fixture({ situacao: "LIQUIDADO" });
  await executarConsultaAutomatica("secret", incompleto.io);
  expect(incompleto.gravacoes[0]?.["_situacao"]).toBe("dados_incompletos");
});
test("não consulta convênio diferente ou sandbox e não interpreta situação desconhecida como pagamento", async () => {
  for (const ambiente of ["homologacao", "outro"]) {
    const f = fixture({ situacao: "LIQUIDADO" });
    await executarConsultaAutomatica("secret", {
      ...f.io,
      config: async () => ({ ...config, ambiente }),
    });
    expect(f.chamadas).toBe(0);
    expect(f.gravacoes[0]?.["_situacao"]).toBe("convenio_divergente");
  }
  const f = fixture({ situacao: "EM_LIQUIDACAO" });
  await executarConsultaAutomatica("secret", f.io);
  expect(f.gravacoes[0]?.["_situacao"]).toBe("pendente");
});
test("erro bancário permite nova tentativa e erro de persistência não confirma a baixa", async () => {
  const f = fixture({});
  await executarConsultaAutomatica("secret", {
    ...f.io,
    consultar: async () => {
      throw new Error("timeout");
    },
  });
  expect(f.gravacoes[0]?.["_situacao"]).toBe("consulta_falhou");
  await expect(
    executarConsultaAutomatica("secret", {
      ...f.io,
      rpc: async <T>(name: string) => {
        if (name.includes("reservar")) return { lease: "lease", itens: [boleto] } as T;
        throw new Error("DB");
      },
    }),
  ).rejects.toThrow("DB");
});
test("endpoint recusa acessos sem o segredo do agendamento", async () => {
  expect(
    (await atenderSicrediAutomatico(new Request("https://erp/api/sicredi/sincronizar"))).status,
  ).toBe(405);
  expect(
    (
      await atenderSicrediAutomatico(
        new Request("https://erp/api/sicredi/sincronizar", { method: "POST" }),
      )
    ).status,
  ).toBe(401);
});

test("falha técnica registra apenas etapa/tipo/HTTP e nunca é liquidação", async () => {
  const { FalhaConsultaSicredi } = await import("../src/lib/sicredi-diagnostico");
  const f = fixture({});
  await executarConsultaAutomatica("secret", {
    ...f.io,
    consultar: async () => {
      throw new FalhaConsultaSicredi(
        { etapa: "token", tipo: "http", http_status: 401 },
        "senha=SEGREDO; retorno privado",
      );
    },
  });
  expect(f.gravacoes[0]?.["_situacao"]).toBe("consulta_falhou");
  expect(f.gravacoes[0]?.["_dados"]).toEqual({
    diagnostico: { etapa: "token", tipo: "http", http_status: 401 },
  });
  expect(JSON.stringify(f.gravacoes)).not.toContain("SEGREDO");
});

test("timeout/rede/erro desconhecido geram códigos seguros sem copiar mensagens", async () => {
  const { diagnosticoConsultaSicredi } = await import("../src/lib/sicredi-diagnostico");
  const timeout = new Error("Authorization: privado");
  timeout.name = "TimeoutError";
  expect(diagnosticoConsultaSicredi(timeout)).toEqual({ etapa: "consulta", tipo: "timeout" });
  expect(diagnosticoConsultaSicredi(new TypeError("URL com dados"))).toEqual({
    etapa: "consulta",
    tipo: "rede",
  });
  expect(
    diagnosticoConsultaSicredi({ etapa: "token", http_status: 403, token: "privado" }),
  ).toEqual({ etapa: "consulta", tipo: "nao_identificada" });
});

test("endpoint distingue HTTP bancário sem copiar corpo privado e sem repetir chamadas", async () => {
  const fetchOriginal = globalThis.fetch;
  const urlOriginal = process.env["EXT_SUPABASE_URL"];
  const keyOriginal = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
  const gravacoes: Record<string, unknown>[] = [];
  let chamadasBanco = 0;
  process.env["EXT_SUPABASE_URL"] = "https://db.test";
  process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] = "service-fixture";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("sicredi_auto_reservar_247"))
      return Response.json({ lease: "lease", itens: [boleto] });
    if (url.includes("/sicredi_config?"))
      return Response.json([
        {
          ...config,
          api_key: "fixture-api",
          username: `${boleto.codigo_beneficiario}${boleto.cooperativa}`,
          password: "fixture-password",
        },
      ]);
    if (url.endsWith("sicredi_token_reservar_224"))
      return Response.json({ access_token: "private-fixture-token" });
    if (url.includes("/cobranca/boleto/v2/boletos?")) {
      chamadasBanco++;
      return new Response("CORPO_PRIVADO", { status: 503 });
    }
    if (url.endsWith("sicredi_auto_finalizar_247")) {
      gravacoes.push(JSON.parse(String(init?.body)));
      return Response.json("consulta_falhou");
    }
    throw new Error("Chamada inesperada no transporte simulado");
  }) as typeof fetch;
  try {
    const response = await atenderSicrediAutomatico(
      new Request("https://erp/api/sicredi/sincronizar", {
        method: "POST",
        headers: { Authorization: `Bearer ${"a".repeat(64)}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ consultados: 0, processados: 0 });
    expect(chamadasBanco).toBe(1);
    expect(gravacoes[0]?.["_dados"]).toEqual({
      diagnostico: { etapa: "consulta", tipo: "http", http_status: 503 },
    });
    expect(JSON.stringify(gravacoes)).not.toContain("CORPO_PRIVADO");
    expect(JSON.stringify(gravacoes)).not.toContain("private-fixture-token");
  } finally {
    globalThis.fetch = fetchOriginal;
    if (urlOriginal === undefined) delete process.env["EXT_SUPABASE_URL"];
    else process.env["EXT_SUPABASE_URL"] = urlOriginal;
    if (keyOriginal === undefined) delete process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
    else process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] = keyOriginal;
  }
});

test("token salvo com resposta RPC vazia permite continuar a consulta automática", async () => {
  const fetchOriginal = globalThis.fetch;
  const urlOriginal = process.env["EXT_SUPABASE_URL"];
  const keyOriginal = process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
  process.env["EXT_SUPABASE_URL"] = "https://db.test";
  process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] = "service-fixture";
  try {
    for (const statusVazio of [204, 200]) {
      let autenticacoes = 0,
        conclusoes = 0,
        consultas = 0;
      const gravacoes: Record<string, unknown>[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("sicredi_auto_reservar_247"))
          return Response.json({ lease: "lease", itens: [boleto] });
        if (url.includes("/sicredi_config?"))
          return Response.json([
            {
              ...config,
              api_key: "fixture-api",
              username: `${boleto.codigo_beneficiario}${boleto.cooperativa}`,
              password: "fixture-password",
            },
          ]);
        if (url.endsWith("sicredi_token_reservar_224"))
          return Response.json({ lease: "fixture-token-lease" });
        if (url.endsWith("/auth/openapi/token")) {
          autenticacoes++;
          return Response.json({ access_token: "private-fixture-token", expires_in: 300 });
        }
        if (url.endsWith("sicredi_token_concluir_224")) {
          conclusoes++;
          return new Response(null, { status: statusVazio });
        }
        if (url.includes("/cobranca/boleto/v2/boletos?")) {
          consultas++;
          expect(init?.method ?? "GET").toBe("GET");
          return Response.json({ situacao: "REGISTRADO" });
        }
        if (url.endsWith("sicredi_auto_finalizar_247")) {
          const args = JSON.parse(String(init?.body));
          gravacoes.push(args);
          return Response.json(args._situacao);
        }
        throw new Error("Chamada inesperada no transporte simulado");
      }) as typeof fetch;
      const response = await atenderSicrediAutomatico(
        new Request("https://erp/api/sicredi/sincronizar", {
          method: "POST",
          headers: { Authorization: `Bearer ${"a".repeat(64)}` },
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ consultados: 1, processados: 0 });
      expect(autenticacoes).toBe(1);
      expect(conclusoes).toBe(1);
      expect(consultas).toBe(1);
      expect(gravacoes[0]?.["_situacao"]).toBe("pendente");
      expect(gravacoes[0]?.["_dados"]).toBeNull();
    }
  } finally {
    globalThis.fetch = fetchOriginal;
    if (urlOriginal === undefined) delete process.env["EXT_SUPABASE_URL"];
    else process.env["EXT_SUPABASE_URL"] = urlOriginal;
    if (keyOriginal === undefined) delete process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"];
    else process.env["EXT_SUPABASE_SERVICE_ROLE_KEY"] = keyOriginal;
  }
});
