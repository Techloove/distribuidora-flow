import { afterAll, afterEach, beforeAll, expect, mock, setSystemTime, test } from "bun:test";
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      inputValidator: () => builder,
      validator: () => builder,
      handler: (fn: (input: unknown) => unknown) => (input: unknown) => fn(input),
    };
    return builder;
  },
}));
const { sicrediAlterarCondicoes, sicrediPreviaCondicoes, sicrediConferirCondicoes } =
  await import("../src/lib/sicredi.functions");
const originalFetch = globalThis.fetch;
const envKeys = ["EXT_SUPABASE_URL", "EXT_SUPABASE_ANON_KEY", "EXT_SUPABASE_SERVICE_ROLE_KEY"];
const oldEnv = envKeys.map((key) => process.env[key]);
beforeAll(() => {
  setSystemTime(new Date("2026-10-06T15:00:00Z"));
  process.env.EXT_SUPABASE_URL = "https://fixture.supabase.test";
  process.env.EXT_SUPABASE_ANON_KEY = "fixture-anon";
  process.env.EXT_SUPABASE_SERVICE_ROLE_KEY = "fixture-service";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
afterAll(() => {
  setSystemTime();
  envKeys.forEach((key, index) => {
    if (oldEnv[index] === undefined) delete process.env[key];
    else process.env[key] = oldEnv[index];
  });
});
const boleto = {
  id: "00000000-0000-4000-8000-000000000007",
  banco: "sicredi",
  nosso_numero: "262000020",
  status: "registrado",
  canal: "api",
  ambiente: "producao",
  cooperativa: "0165",
  posto: "02",
  codigo_beneficiario: "00623",
  vencimento: "2026-10-30",
  valor: 100,
  linha_digitavel: "74891121150039736789903123451001187340000000050",
  centro_id: "00000000-0000-4000-8000-000000000010",
};
function backend(
  options: {
    status?: number;
    errorBody?: string;
    timeout?: boolean;
    bankDue?: string;
    wrongContract?: boolean;
    pending?: boolean;
    role?: string;
    duplicate?: boolean;
    changed?: boolean;
    confirmed?: boolean;
    wrongIdentity?: boolean;
    reserveFailure?: boolean;
    persistFailure?: boolean;
  } = {},
) {
  const calls: { path: string; method: string; body: Record<string, unknown>; headers: Headers }[] =
    [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const body = init?.body
      ? init.body instanceof URLSearchParams
        ? Object.fromEntries(init.body)
        : JSON.parse(String(init.body))
      : {};
    calls.push({ path, method: init?.method ?? "GET", body, headers: new Headers(init?.headers) });
    let out: unknown = [];
    if (path === "/auth/v1/user") out = { id: "00000000-0000-4000-8000-000000000001" };
    else if (path.endsWith("/profiles")) out = [{ ativo: true }];
    else if (path.endsWith("/user_roles")) out = [{ role: options.role ?? "admin" }];
    else if (path.endsWith("/consumir_rate_limit")) out = true;
    else if (path === "/rest/v1/boletos")
      out = [
        {
          ...boleto,
          ...(options.pending ? { condicoes_pendente_292: "request-fixture" } : {}),
        },
      ];
    else if (path.endsWith("/sicredi_config"))
      out = [
        {
          api_key: "fixture-key",
          username: options.wrongContract ? "006239999" : "006230165",
          password: "fixture-password",
          cooperativa: options.wrongContract ? "9999" : "0165",
          posto: "02",
          codigo_beneficiario: "00623",
          ambiente: "producao",
        },
      ];
    else if (path.endsWith("/sicredi_token_reservar_224"))
      out = { access_token: "fixture-bank-token" };
    else if (path.includes("/auth/openapi/token"))
      out = { access_token: "fixture-bank-token", expires_in: 300 };
    else if (path.endsWith("/sicredi_reservar_condicoes_292")) {
      if (options.reserveFailure)
        return new Response(
          JSON.stringify({ code: "P0001", message: "Existe instrução pendente" }),
          { status: 400 },
        );
      out = { id: "request-fixture", enviar: !options.duplicate };
    } else if (path.endsWith("/sicredi_finalizar_condicoes_292") && options.persistFailure) {
      return new Response("{}", { status: 500 });
    } else if (path.endsWith("/sicredi_condicoes_historico_292"))
      out = [{ id: "request-fixture", esperado: { ...anterior, abatimento: 10 } }];
    else if (init?.method === "PATCH") {
      if (options.timeout) throw new Error("fixture timeout");
      return new Response(options.errorBody ?? "{}", { status: options.status ?? 202 });
    } else if (url.hostname === "api-parceiro.sicredi.com.br" && path.endsWith("/boletos"))
      out = {
        situacao: "EM CARTEIRA",
        nossoNumero: options.wrongIdentity ? "999999999" : boleto.nosso_numero,
        linhaDigitavel: boleto.linha_digitavel,
        valorNominal: 100,
        abatimento: options.confirmed ? 10 : 0,
        tipoDesconto: "NAO_TEM_DESCONTO",
        descontos: [],
        dataVencimento: options.changed ? "2026-11-30" : "2026-10-30",
      };
    else if (path.startsWith("/rest/v1/rpc/")) out = null;
    else throw new Error("Unexpected fixture request: " + path);
    return new Response(JSON.stringify(out), { status: 200 });
  }) as typeof fetch;
  return calls;
}

const anterior = {
  nominal: 100,
  abatimento: 0,
  tipoDesconto: "SEM_DESCONTO" as const,
  descontos: [],
  vencimento: "2026-10-30",
  situacao: "EM CARTEIRA",
};
const data = {
  boletoId: boleto.id,
  accessToken: "fixture-jwt",
  chave: "00000000-0000-4000-8000-000000000099",
  motivo: "Acordo com cliente",
  instrucao: { tipo: "abatimento" as const, valor: 10 },
  anterior,
};
test("reserva antes de PATCH, 202 mantém pendente, cabeçalhos e valorAbatimento conforme manual", async () => {
  const calls = backend();
  const r = await sicrediAlterarCondicoes({ data });
  expect(r.mensagem).toContain("enviada");
  const patch = calls.find((c) => c.method === "PATCH")!;
  expect(patch.path.endsWith("/conceder-abatimento")).toBe(true);
  expect(patch.body).toEqual({ valorAbatimento: "10.00" });
  expect(patch.headers.get("codigoBeneficiario")).toBe("00623");
  expect(calls.findIndex((c) => c.path.endsWith("/sicredi_reservar_condicoes_292"))).toBeLessThan(
    calls.indexOf(patch),
  );
  expect(calls.some((c) => c.body._estado === "confirmado")).toBe(false);
  expect(calls.some((c) => c.body._estado === "enviado")).toBe(true);
});
test("bloqueia financeiro não administrador, convênio, identidade, mudança concorrente e pendência", async () => {
  for (const opts of [
    { role: "financeiro" },
    { wrongContract: true },
    { wrongIdentity: true },
    { changed: true },
    { pending: true },
    { reserveFailure: true },
  ]) {
    const calls = backend(opts);
    await expect(sicrediAlterarCondicoes({ data })).rejects.toThrow();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  }
});
test("UUID repetido não reenvia; timeout, 429, 5xx e 200 inesperado ficam incertos", async () => {
  let calls = backend({ duplicate: true });
  await sicrediAlterarCondicoes({ data });
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  for (const opts of [{ timeout: true }, { status: 429 }, { status: 503 }, { status: 200 }]) {
    calls = backend(opts);
    await sicrediAlterarCondicoes({ data });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(calls.some((c) => c.body._estado === "incerto")).toBe(true);
  }
});
test("recusa definitiva libera como rejeitado e falha de persistência não reenvia", async () => {
  const calls = backend({ status: 422 });
  await expect(sicrediAlterarCondicoes({ data })).rejects.toThrow("422");
  expect(calls.some((c) => c.body._estado === "rejeitado")).toBe(true);
  const fail = backend({ persistFailure: true });
  await expect(sicrediAlterarCondicoes({ data })).rejects.toThrow();
  expect(fail.filter((c) => c.method === "PATCH")).toHaveLength(1);
});
test("consulta é somente leitura; conferência exige snapshot bancário esperado", async () => {
  let calls = backend();
  await sicrediPreviaCondicoes({ data: { boletoId: boleto.id, accessToken: "fixture-jwt" } });
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  calls = backend({ pending: true });
  const old = await sicrediConferirCondicoes({
    data: { boletoId: boleto.id, accessToken: "fixture-jwt" },
  });
  expect(old.mensagem).toContain("ainda não");
  expect(calls.some((c) => c.body._estado === "confirmado")).toBe(false);
  calls = backend({ pending: true, confirmed: true });
  const ok = await sicrediConferirCondicoes({
    data: { boletoId: boleto.id, accessToken: "fixture-jwt" },
  });
  expect(ok.mensagem).toContain("confirmada");
  expect(calls.some((c) => c.body._estado === "confirmado")).toBe(true);
  expect(calls.some((c) => c.method === "PATCH")).toBe(false);
});
