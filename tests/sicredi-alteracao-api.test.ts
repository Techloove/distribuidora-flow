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
const { sicrediAlterarVencimento, sicrediConsultarBoleto } =
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
  nosso_numero: "262000020",
  status: "registrado",
  canal: "api",
  ambiente: "producao",
  cooperativa: "0165",
  posto: "02",
  codigo_beneficiario: "00623",
  vencimento: "2026-10-30",
  valor: 100,
};
function backend(
  options: {
    status?: number;
    timeout?: boolean;
    bankDue?: string;
    wrongContract?: boolean;
    pending?: boolean;
  } = {},
) {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const body = init?.body
      ? init.body instanceof URLSearchParams
        ? Object.fromEntries(init.body)
        : JSON.parse(String(init.body))
      : {};
    calls.push({ path, method: init?.method ?? "GET", body });
    let out: unknown = [];
    if (path === "/auth/v1/user") out = { id: "00000000-0000-4000-8000-000000000001" };
    else if (path.endsWith("/profiles")) out = [{ ativo: true }];
    else if (path.endsWith("/user_roles")) out = [{ role: "financeiro" }];
    else if (path.endsWith("/consumir_rate_limit")) out = true;
    else if (path === "/rest/v1/boletos")
      out = [
        {
          ...boleto,
          ...(options.pending
            ? { vencimento_solicitacao_id: "request-fixture", vencimento_solicitado: "2026-11-20" }
            : {}),
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
    else if (path.endsWith("/sicredi_solicitar_vencimento")) out = "request-fixture";
    else if (path.endsWith("/data-vencimento")) {
      if (options.timeout) throw new Error("fixture timeout");
      return new Response("{}", { status: options.status ?? 200 });
    } else if (url.hostname === "api-parceiro.sicredi.com.br" && path.endsWith("/boletos"))
      out = { situacao: "REGISTRADO", dataVencimento: options.bankDue };
    else if (path.startsWith("/rest/v1/rpc/")) out = null;
    else throw new Error("Unexpected fixture request: " + path);
    return new Response(JSON.stringify(out), { status: 200 });
  }) as typeof fetch;
  return calls;
}
test("API envia PATCH com data ISO e conserva solicitação pendente até consulta", async () => {
  const calls = backend();
  const result = await sicrediAlterarVencimento({
    data: { boletoId: boleto.id, vencimento: "2026-11-20", accessToken: "fixture-jwt" },
  });
  expect(result.pendente).toBe(true);
  const patch = calls.find((c) => c.path.endsWith("/data-vencimento"))!;
  expect(patch.method).toBe("PATCH");
  expect(patch.body).toEqual({ dataVencimento: "2026-11-20" });
  expect(calls.findIndex((c) => c.path.endsWith("/sicredi_solicitar_vencimento"))).toBeLessThan(
    calls.indexOf(patch),
  );
  expect(calls.some((c) => c.body._estado === "confirmado")).toBe(false);
  expect(calls.some((c) => c.body._estado === "enviado")).toBe(true);
});
test("timeout não permite reenvio silencioso nem confirmação falsa", async () => {
  const calls = backend({ timeout: true });
  await sicrediAlterarVencimento({
    data: { boletoId: boleto.id, vencimento: "2026-11-20", accessToken: "fixture-jwt" },
  });
  expect(calls.filter((c) => c.path.endsWith("/data-vencimento"))).toHaveLength(1);
  expect(calls.some((c) => c.body._estado === "incerto")).toBe(true);
  expect(calls.some((c) => c.body._estado === "confirmado")).toBe(false);
});
test("rejeição definitiva libera solicitação e convênio divergente impede chamada bancária", async () => {
  let calls = backend({ status: 400 });
  await expect(
    sicrediAlterarVencimento({
      data: { boletoId: boleto.id, vencimento: "2026-11-20", accessToken: "fixture-jwt" },
    }),
  ).rejects.toThrow("rejeitou");
  expect(calls.some((c) => c.body._estado === "rejeitado")).toBe(true);
  calls = backend({ wrongContract: true });
  await expect(
    sicrediAlterarVencimento({
      data: { boletoId: boleto.id, vencimento: "2026-11-20", accessToken: "fixture-jwt" },
    }),
  ).rejects.toThrow("convênio");
  expect(calls.some((c) => c.path.endsWith("/data-vencimento"))).toBe(false);
});
test("consulta confirma somente quando banco devolve o vencimento solicitado", async () => {
  let calls = backend({ pending: true, bankDue: "2026-10-30" });
  await sicrediConsultarBoleto({ data: { boletoId: boleto.id, accessToken: "fixture-jwt" } });
  expect(calls.some((c) => c.body._estado === "confirmado")).toBe(false);
  calls = backend({ pending: true, bankDue: "20/11/2026" });
  await sicrediConsultarBoleto({ data: { boletoId: boleto.id, accessToken: "fixture-jwt" } });
  expect(calls.find((c) => c.body._estado === "confirmado")?.body._vencimento_banco).toBe(
    "2026-11-20",
  );
});
