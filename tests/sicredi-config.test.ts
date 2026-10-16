import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      inputValidator: () => builder,
      handler: (fn: (input: unknown) => unknown) => (input: unknown) => fn(input),
    };
    return builder;
  },
}));
const { sicrediConfigGet, sicrediConfigSave } = await import("../src/lib/sicredi-config.functions");
const originalFetch = globalThis.fetch;
const keys = ["EXT_SUPABASE_URL", "EXT_SUPABASE_ANON_KEY", "EXT_SUPABASE_SERVICE_ROLE_KEY"];
const previous = keys.map((key) => process.env[key]);
beforeAll(() => {
  process.env.EXT_SUPABASE_URL = "https://fixture.supabase.test";
  process.env.EXT_SUPABASE_ANON_KEY = "fixture-anon";
  process.env.EXT_SUPABASE_SERVICE_ROLE_KEY = "fixture-service";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
afterAll(() =>
  keys.forEach((key, i) => {
    if (previous[i] === undefined) delete process.env[key];
    else process.env[key] = previous[i];
  }),
);
const actor = "00000000-0000-4000-8000-000000000001";
function backend(role = "admin", error?: { code: string; message: string; details?: string }) {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname,
      body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method: init?.method ?? "GET", body });
    let out: unknown;
    if (path === "/auth/v1/user") out = { id: actor };
    else if (path.endsWith("/profiles")) out = [{ ativo: true }];
    else if (path.endsWith("/user_roles")) out = [{ role }];
    else if (path.endsWith("/consumir_rate_limit")) out = true;
    else if (path.endsWith("/sicredi_config"))
      out = [
        {
          api_key: "fixture-private-key",
          sandbox_api_key: "fixture-private-sandbox-key",
          password: "fixture-private-password",
          username: "fixture-user",
          cooperativa: "0165",
          posto: "02",
          codigo_beneficiario: "00623",
          tipo_cobranca: "NORMAL",
        },
      ];
    else if (path.endsWith("/cobranca_centros")) out = [];
    else if (path.endsWith("/validar_cobranca_centro_237")) out = null;
    else if (path.endsWith("/salvar_cobranca_centro_237")) {
      if (error) return new Response(JSON.stringify(error), { status: 400 });
      out = null;
    } else throw new Error("Unexpected fixture request " + path);
    return new Response(JSON.stringify(out), { status: 200 });
  }) as typeof fetch;
  return calls;
}
const input = {
  accessToken: "fixture-jwt",
  cooperativa: "0165",
  posto: "02",
  codigo_beneficiario: "00623",
  tipo_cobranca: "NORMAL",
  tipo_juro: "PERCENTUAL",
  juros: 2,
  multa: 3,
  centro_id: actor,
  banco: "sicredi" as const,
  ativo: true,
  conta_financeira_id: actor,
};
test("configuração por centro não envia segredos ao navegador", async () => {
  backend("gestor");
  const result = await sicrediConfigGet({ data: { accessToken: "fixture-jwt", centro_id: actor } });
  expect(result.api_key).toBe("");
  expect(result.password).toBe("");
  expect(result.api_key_configurada).toBe(true);
  expect(result.sandbox_api_key_configurada).toBe(true);
  expect(result.password_configurada).toBe(true);
  expect(result.convenio_preservado).toBe(true);
  expect(JSON.stringify(result)).not.toContain("fixture-private");
});
test("salvamento atômico vincula API e conta ao centro, sem parâmetros CNAB", async () => {
  const calls = backend();
  await sicrediConfigSave({ data: input });
  const writes = calls.filter((c) => c.path.endsWith("/salvar_cobranca_centro_237"));
  expect(writes).toHaveLength(1);
  expect(writes[0]?.body).toMatchObject({
    _actor: actor,
    _centro: actor,
    _banco: "sicredi",
    _ativo: true,
    _conta: actor,
  });
  expect(writes[0]?.body._api).not.toHaveProperty("api_key");
  expect(writes[0]?.body._api).not.toHaveProperty("password");
  expect(writes[0]?.body).not.toHaveProperty("_cnab");
  expect(calls.some((c) => c.path.includes("cnab"))).toBe(false);
});
test("gestor não salva e juros por valor são permitidos na API", async () => {
  const calls = backend("gestor");
  await expect(sicrediConfigSave({ data: input })).rejects.toThrow("sem permissão");
  expect(calls.some((c) => c.path.endsWith("salvar_cobranca_centro_237"))).toBe(false);
  backend();
  await expect(
    sicrediConfigSave({ data: { ...input, tipo_juro: "VALOR" } }),
  ).resolves.toMatchObject({ salvo: true });
});
test("Sicoob pendente não requer credenciais Sicredi nem habilita emissão", async () => {
  const calls = backend();
  await sicrediConfigSave({
    data: { accessToken: "fixture-jwt", centro_id: actor, banco: "sicoob", ativo: true },
  });
  expect(calls.find((c) => c.path.endsWith("/salvar_cobranca_centro_237"))?.body).toMatchObject({
    _banco: "sicoob",
    _ativo: false,
    _api: null,
  });
  expect(calls.some((c) => c.path.endsWith("/sicredi_config"))).toBe(false);
});
test("erros de constraints não expõem segredos", async () => {
  backend("admin", {
    code: "23514",
    message: "failed row fixture-private-key",
    details: "fixture-private-password",
  });
  await expect(sicrediConfigSave({ data: input })).rejects.toThrow("fase237");
});
