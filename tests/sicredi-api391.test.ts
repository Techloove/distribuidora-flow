import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import {
  liquidacaoSicredi,
  linhaDigitavelSicredi,
  motivoRecusaSicredi,
} from "../src/lib/sicredi-api";
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = {
      inputValidator: () => b,
      handler: (fn: (input: unknown) => unknown) => (input: unknown) => fn(input),
    };
    return b;
  },
}));
const {
  sicrediPdfBoleto,
  sicrediConsultarBoleto,
  sicrediEmitirBoleto,
  sicrediConfirmarNossoNumero,
} = await import("../src/lib/sicredi.functions");
const originalFetch = globalThis.fetch;
const keys = ["EXT_SUPABASE_URL", "EXT_SUPABASE_ANON_KEY", "EXT_SUPABASE_SERVICE_ROLE_KEY"],
  previous = keys.map((k) => process.env[k]);
beforeAll(() => {
  process.env.EXT_SUPABASE_URL = "https://fixture.supabase.test";
  process.env.EXT_SUPABASE_ANON_KEY = "fixture-anon";
  process.env.EXT_SUPABASE_SERVICE_ROLE_KEY = "fixture-service";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
afterAll(() =>
  keys.forEach((k, i) => {
    if (previous[i] === undefined) delete process.env[k];
    else process.env[k] = previous[i];
  }),
);
const id = "00000000-0000-4000-8000-000000000007",
  line = "74891121150039736789903123451001187340000000050",
  barcode = "748" + "1".repeat(41),
  date = "2026-11-30";
type Options = {
  sandbox?: boolean;
  legacyCounter?: boolean;
  markerFailed?: boolean;
  wrongLine?: boolean;
  retry?: boolean;
  recovery?: "found" | "missing" | "multiple" | "unavailable" | "wrong";
  timeout?: boolean;
  postStatus?: number;
  postBody?: unknown;
  payerName?: string;
  missingNosso?: boolean;
  badCep?: boolean;
  liquidado?: boolean;
  badSettlement?: boolean;
  invalidLine?: boolean;
  definitive?: boolean;
  configChanged?: boolean;
  persistFailed?: boolean;
  centroBloqueado?: boolean;
};
function backend(o: Options = {}) {
  const calls: {
    path: string;
    query: URLSearchParams;
    method: string;
    body: Record<string, unknown>;
    headers: Headers;
  }[] = [];
  const coop = o.sandbox ? "6789" : "0165",
    posto = o.sandbox ? "03" : "02",
    ben = o.sandbox ? "12345" : "00623",
    ambiente = o.sandbox ? "homologacao" : "producao";
  let reads = 0;
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input)),
      p = u.pathname,
      body = init?.body
        ? init.body instanceof URLSearchParams
          ? Object.fromEntries(init.body)
          : JSON.parse(String(init.body))
        : {};
    calls.push({
      path: p,
      query: u.searchParams,
      method: init?.method ?? "GET",
      body,
      headers: new Headers(init?.headers),
    });
    let out: unknown = [];
    if (p === "/auth/v1/user") out = { id };
    else if (p.endsWith("/profiles")) out = [{ ativo: true }];
    else if (p.endsWith("/user_roles")) out = [{ role: "financeiro" }];
    else if (p.endsWith("/consumir_rate_limit")) out = true;
    else if (p.endsWith("/cobranca_centros"))
      out = [
        {
          banco: o.centroBloqueado ? "sicoob" : "sicredi",
          canal: o.centroBloqueado ? "pendente" : "api",
          ativo: !o.centroBloqueado,
        },
      ];
    else if (p.endsWith("/sicredi_config")) {
      reads++;
      out = [
        {
          api_key: "fixture-prod-key",
          sandbox_api_key: "fixture-sandbox-key",
          username: "006230165",
          password: "fixture-prod-password",
          cooperativa: "0165",
          posto: "02",
          codigo_beneficiario: "00623",
          ambiente: o.configChanged && reads > 1 ? "homologacao" : ambiente,
          tipo_cobranca: "NORMAL",
          validade_apos_vencimento: 90,
        },
      ];
    } else if (p.endsWith("/sicredi_token_reservar_224"))
      out = { access_token: "fixture-bank-token" };
    else if (p.endsWith("/vw_boletos_pendentes"))
      out = [
        {
          conta_receber_id: id,
          centro_id: id,
          razao_social: o.payerName ?? "Cliente teste",
          cnpj_cpf: "12345678000195",
          logradouro: "Rua Teste",
          cidade: "Vitória",
          uf: "ES",
          cep: o.badCep ? "123" : "29000000",
          saldo: 100,
          vencimento: date,
        },
      ];
    else if (p === "/rest/v1/boletos")
      out = [
        {
          id,
          banco: "sicredi",
          nosso_numero: o.missingNosso ? null : "262000020",
          linha_digitavel: o.invalidLine ? "" : line,
          valor: 100,
          status: "registrado",
          canal: "api",
          ambiente,
          cooperativa: coop,
          posto,
          codigo_beneficiario: ben,
        },
      ];
    else if (p.endsWith("/preparar_boleto_sicredi_servidor"))
      out = {
        id,
        seu_numero: "1234567890",
        valor: 100,
        vencimento: date,
        tentativas: o.legacyCounter ? 1 : o.retry ? 2 : 1,
        emissao_retentativa: o.retry,
        emissao_inconclusiva: !o.definitive,
        ambiente,
        cooperativa: coop,
        posto,
        codigo_beneficiario: ben,
      };
    else if (p.endsWith("/boletos/cadastrados")) {
      if (o.recovery === "missing") return new Response("{}", { status: 404 });
      if (o.recovery === "unavailable") return new Response("{}", { status: 503 });
      const item = {
        seuNumero: "1234567890",
        valorNominal: o.recovery === "wrong" ? 101 : 100,
        pagador: { documento: "12345678000195" },
        linhaDigitavel: line,
        codigoBarras: barcode,
      };
      out = o.recovery === "multiple" ? [item, item] : [item];
    } else if (p.endsWith("/boletos/pdf"))
      return new Response("%PDF-1.7\nfixture", {
        headers: { "Content-Type": "application/octet-stream" },
      });
    else if (u.hostname === "api-parceiro.sicredi.com.br" && p.endsWith("/boletos")) {
      if (init?.method === "POST") {
        if (o.timeout) throw new Error("fixture-timeout");
        if (o.postStatus)
          return new Response(JSON.stringify(o.postBody ?? {}), { status: o.postStatus });
        out = { nossoNumero: "262000020", linhaDigitavel: line, codigoBarras: barcode };
      } else
        out = {
          situacao: o.liquidado ? "LIQUIDADO" : "REGISTRADO",
          linhaDigitavel: o.wrongLine ? "748" + "1".repeat(44) : line,
          dataMovimento: "2026-10-14",
          dadosLiquidacao: o.badSettlement
            ? null
            : {
                valor: 107,
                juros: 5,
                multa: 2,
                desconto: 0,
                abatimento: 0,
                data: "2026-10-14T12:00:00Z",
              },
        };
    } else if (p.endsWith("/registrar_boleto_sicredi_servidor") && o.persistFailed)
      return new Response(
        JSON.stringify({ code: "P0001", message: "Titulo mudou depois do envio" }),
        { status: 400 },
      );
    else if (p.endsWith("/sicredi_marcar_emissao_224") && o.markerFailed)
      return new Response(
        JSON.stringify({ code: "P0001", message: "Falha no armazenamento seguro" }),
        { status: 400 },
      );
    else if (p.startsWith("/rest/v1/rpc/")) out = null;
    else throw new Error("Unexpected request " + p);
    return new Response(JSON.stringify(out));
  }) as typeof fetch;
  return calls;
}
const emitir = () => sicrediEmitirBoleto({ data: { contaId: id, accessToken: "fixture-jwt" } });
test("PDF usa linha digitável obrigatória e funciona para registro recuperado sem nosso número", async () => {
  const calls = backend({ missingNosso: true });
  const r = await sicrediPdfBoleto({ data: { boletoId: id, accessToken: "fixture-jwt" } });
  expect(atob(r.base64)).toStartWith("%PDF");
  const request = calls.find((c) => c.path.endsWith("/boletos/pdf"))!;
  expect(request.query.get("linhaDigitavel")).toBe(line);
  expect(request.query.has("nossoNumero")).toBe(false);
  backend({ invalidLine: true });
  await expect(
    sicrediPdfBoleto({ data: { boletoId: id, accessToken: "fixture-jwt" } }),
  ).rejects.toThrow("47 dígitos");
});
test("liquidação usa 107 reais e encargos reais do banco, sem baixa pelo nominal100", async () => {
  const calls = backend({ liquidado: true });
  const r = await sicrediConsultarBoleto({ data: { boletoId: id, accessToken: "fixture-jwt" } });
  expect(r.liquidado).toBe(true);
  expect(calls.find((c) => c.path.endsWith("/sicredi_liquidar_api_224"))?.body._dados).toEqual({
    data: "2026-10-14",
    valor: 107,
    juros: 5,
    multa: 2,
    desconto: 0,
    abatimento: 0,
  });
  expect(calls.some((c) => c.path.endsWith("/liquidar_boleto"))).toBe(false);
  expect(
    calls
      .find((c) => c.path.endsWith("/cobranca/boleto/v2/boletos"))
      ?.headers.get("data-movimento"),
  ).toBe("true");
});
test("liquidação incompleta não movimenta caixa e sandbox permanece simulação", async () => {
  let calls = backend({ liquidado: true, badSettlement: true });
  await expect(
    sicrediConsultarBoleto({ data: { boletoId: id, accessToken: "fixture-jwt" } }),
  ).rejects.toThrow("dados de liquidação");
  expect(calls.some((c) => c.path.endsWith("/sicredi_liquidar_api_224"))).toBe(false);
  calls = backend({ liquidado: true, sandbox: true });
  const r = await sicrediConsultarBoleto({ data: { boletoId: id, accessToken: "fixture-jwt" } });
  expect(r.liquidado).toBe(false);
  expect(r.situacao).toContain("simulação");
  expect(calls.some((c) => c.path.endsWith("/sicredi_liquidar_api_224"))).toBe(false);
});
test("sandbox emite com chave e identificadores próprios, preservando configuração real", async () => {
  const calls = backend({ sandbox: true });
  await emitir();
  const req = calls.find(
    (c) => c.method === "POST" && c.path === "/sb/cobranca/boleto/v1/boletos",
  )!;
  expect(req.headers.get("x-api-key")).toBe("fixture-sandbox-key");
  expect(req.headers.get("cooperativa")).toBe("6789");
  expect(req.headers.get("posto")).toBe("03");
  expect(req.body.codigoBeneficiario).toBe("12345");
  expect(req.body.tipoCobranca).toBe("NORMAL");
  expect(req.body).not.toHaveProperty("validadeAposVencimento");
  expect(calls.some((c) => c.path.endsWith("/sicredi_salvar_convenio_223"))).toBe(false);
});
test("registro inconclusivo encontrado é recuperado sem novo POST mesmo sem nossoNumero na resposta", async () => {
  const calls = backend({ retry: true, recovery: "found" });
  const r = await emitir();
  expect(r.recuperado).toBe(true);
  expect(r.linhaDigitavel).toBe(line);
  expect(calls.some((c) => c.method === "POST" && c.path === "/cobranca/boleto/v1/boletos")).toBe(
    false,
  );
  expect(
    calls.find((c) => c.path.endsWith("/registrar_boleto_sicredi_servidor"))?.body._linha_digitavel,
  ).toBe(line);
});
test("404 documentado libera reenvio somente após consulta por seuNumero", async () => {
  const calls = backend({ retry: true, recovery: "missing" });
  await emitir();
  const query = calls.findIndex((c) => c.path.endsWith("/boletos/cadastrados")),
    post = calls.findIndex((c) => c.method === "POST" && c.path === "/cobranca/boleto/v1/boletos");
  expect(query).toBeGreaterThan(0);
  expect(post).toBeGreaterThan(query);
});
test("resultado múltiplo, divergente ou indisponível impede reenvio", async () => {
  for (const recovery of ["multiple", "wrong", "unavailable"] as const) {
    const calls = backend({ retry: true, recovery });
    await expect(emitir()).rejects.toThrow();
    expect(calls.some((c) => c.method === "POST" && c.path === "/cobranca/boleto/v1/boletos")).toBe(
      false,
    );
  }
});
test("timeout e erro5xx mantêm emissão inconclusiva; rejeição422 admite correção", async () => {
  for (const options of [{ timeout: true }, { postStatus: 503 }] as const) {
    const calls = backend(options);
    await expect(emitir()).rejects.toThrow("inconclusiva");
    expect(calls.find((c) => c.path.endsWith("/sicredi_marcar_emissao_224"))?.body._estado).toBe(
      "inconclusivo",
    );
    expect(calls.some((c) => c.path.endsWith("/registrar_erro_boleto_sicredi_servidor"))).toBe(
      false,
    );
  }
  const calls = backend({ postStatus: 422 });
  await expect(emitir()).rejects.toThrow("recusou");
  expect(
    calls.some(
      (c) => c.path.endsWith("/sicredi_marcar_emissao_224") && c.body._estado === "rejeitado",
    ),
  ).toBe(true);
});
test("sandbox inconclusivo fica bloqueado e rejeição definitiva pode ser corrigida", async () => {
  let calls = backend({ sandbox: true, retry: true });
  await expect(emitir()).rejects.toThrow("não está documentada");
  expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/boletos"))).toBe(false);
  calls = backend({ sandbox: true, retry: true, definitive: true });
  await emitir();
  expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/boletos"))).toBe(true);
});
test("cadastro incompleto e configuração alterada impedem emissão externa", async () => {
  for (const options of [{ badCep: true }, { configChanged: true }] as const) {
    const calls = backend(options);
    await expect(emitir()).rejects.toThrow();
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/boletos"))).toBe(false);
  }
});
test("aceitação bancária com falha local não confirma nem libera um novo envio", async () => {
  const calls = backend({ persistFailed: true });
  await expect(emitir()).rejects.toThrow("Titulo mudou");
  expect(
    calls.some(
      (c) => c.path.endsWith("/sicredi_marcar_emissao_224") && c.body._estado === "confirmado",
    ),
  ).toBe(false);
});
test("valores e datas bancárias inválidas são rejeitados sem normalizar centavos silenciosamente", () => {
  expect(() =>
    liquidacaoSicredi({ dadosLiquidacao: { valor: 1.001, data: "2026-02-30" } }),
  ).toThrow();
  expect(() =>
    liquidacaoSicredi({
      dataMovimento: "2026-02-30",
      dadosLiquidacao: { valor: 100, data: "2026-10-14" },
    }),
  ).toThrow("movimento inválida");
  expect(() => linhaDigitavelSicredi("001" + "1".repeat(44))).toThrow();
  expect(
    liquidacaoSicredi({
      dadosLiquidacao: { valor: "95.00", desconto: 3, abatimento: 2, data: "2026-10-15T01:00:00Z" },
    }).data,
  ).toBe("2026-10-14");
});

test("reserva legada sem contador também consulta o banco antes de reenviar", async () => {
  const calls = backend({ retry: true, legacyCounter: true, recovery: "found" });
  await emitir();
  expect(calls.some((c) => c.path.endsWith("/boletos/cadastrados"))).toBe(true);
  expect(calls.some((c) => c.method === "POST" && c.path === "/cobranca/boleto/v1/boletos")).toBe(
    false,
  );
});
test("falha ao marcar envio antes do POST não permite chamada externa", async () => {
  const calls = backend({ definitive: true, retry: true, markerFailed: true });
  await expect(emitir()).rejects.toThrow("armazenamento seguro");
  expect(calls.some((c) => c.method === "POST" && c.path === "/cobranca/boleto/v1/boletos")).toBe(
    false,
  );
});

test("nosso número de registro recuperado é confirmado pela linha digitável no banco", async () => {
  const calls = backend({ missingNosso: true });
  await sicrediConfirmarNossoNumero({
    data: { boletoId: id, nossoNumero: "262000020", accessToken: "fixture-jwt" },
  });
  expect(calls.find((c) => c.path.endsWith("/sicredi_vincular_numero_224"))?.body).toEqual({
    _actor: id,
    _boleto: id,
    _nosso: "262000020",
    _linha: line,
  });
});
test("nosso número de outro boleto não substitui identificação recuperada", async () => {
  const calls = backend({ missingNosso: true, wrongLine: true });
  await expect(
    sicrediConfirmarNossoNumero({
      data: { boletoId: id, nossoNumero: "262000021", accessToken: "fixture-jwt" },
    }),
  ).rejects.toThrow("outro boleto");
  expect(calls.some((c) => c.path.endsWith("/sicredi_vincular_numero_224"))).toBe(false);
});

test("centro Sicoob não usa o Sicredi nem autentica ou reserva emissão", async () => {
  const calls = backend({ centroBloqueado: true });
  await expect(
    sicrediEmitirBoleto({ data: { contaId: id, accessToken: "fixture-jwt" } }),
  ).rejects.toThrow("não habilitado");
  expect(
    calls.some(
      (c) =>
        c.path.endsWith("/preparar_boleto_sicredi_servidor") ||
        c.path.endsWith("/sicredi_token_reservar_224") ||
        c.path.includes("/cobranca/boleto/"),
    ),
  ).toBe(false);
});

test("recusa400 mostra e persiste o motivo de validação sem expor credenciais", async () => {
  const calls = backend({
    postStatus: 400,
    postBody: {
      message: "Data de vencimento inválida. Chave fixture-prod-key",
      headers: { password: "fixture-prod-password" },
    },
  });
  await expect(emitir()).rejects.toThrow("Data de vencimento inválida");
  const saved = String(
    calls.find((c) => c.path.endsWith("/registrar_erro_boleto_sicredi_servidor"))?.body._erro,
  );
  expect(saved).toContain("Data de vencimento inválida");
  expect(saved).not.toContain("fixture-prod-key");
  expect(saved).not.toContain("fixture-prod-password");
  expect(
    calls.find(
      (c) => c.path.endsWith("/sicredi_marcar_emissao_224") && c.body._estado === "rejeitado",
    ),
  ).toBeDefined();
});
test("diagnóstico da recusa aceita mensagens estruturadas e ignora corpo bruto ou dados desconhecidos", () => {
  expect(
    motivoRecusaSicredi(
      JSON.stringify({
        errors: [{ message: "CEP inválido" }, { mensagem: "Nome obrigatório" }],
        payload: { password: "segredo" },
      }),
    ),
  ).toBe("CEP inválido · Nome obrigatório");
  expect(motivoRecusaSicredi("<html>segredo</html>")).toBeNull();
  expect(motivoRecusaSicredi(JSON.stringify({ payload: { password: "segredo" } }))).toBeNull();
  expect(
    motivoRecusaSicredi(JSON.stringify({ message: "password=segredo Bearer token-secreto" })),
  ).not.toContain("segredo");
});

test("registro limita nome do pagador a40 caracteres sem alterar a razão social do cadastro", async () => {
  const nome = "BLUNCK MATERIAIS DE CONSTRUCAO E SERVICOS LTDA";
  const calls = backend({ sandbox: true, payerName: `  ${nome}  ` });
  await emitir();
  const req = calls.find(
    (c) => c.method === "POST" && c.path === "/sb/cobranca/boleto/v1/boletos",
  )!;
  expect(req.body.pagador).toMatchObject({
    nome: nome.slice(0, 40).trimEnd(),
    documento: "12345678000195",
  });
  expect(String((req.body.pagador as Record<string, unknown>).nome).length).toBeLessThanOrEqual(40);
  expect(calls.some((c) => c.method !== "GET" && c.path.endsWith("/clientes"))).toBe(false);
  const shortCalls = backend({ payerName: "  Cliente   teste  " });
  await emitir();
  expect(
    shortCalls.find((c) => c.method === "POST" && c.path === "/cobranca/boleto/v1/boletos")?.body
      .pagador,
  ).toMatchObject({ nome: "Cliente teste" });
});
