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
const cnab = {
  centro_id: actor,
  nome: "Distribuidora",
  documento: "12345678000195",
  cooperativa: "0165",
  posto: "02",
  beneficiario: "00623",
  conta: "123456",
  conta_dv: "1",
  conta_financeira_id: actor,
  categoria_tarifa_id: null,
  proxima_remessa: 10,
  proximo_nosso_numero: 40,
  homologado: false,
  juros_mensal: 2,
  multa_percentual: 3,
  tipo_cobranca: "NORMAL" as const,
};
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
          password: "fixture-private-password",
          username: "fixture-user",
          cooperativa: "0165",
          posto: "02",
          codigo_beneficiario: "00623",
          tipo_cobranca: "NORMAL",
        },
      ];
    else if (path.endsWith("/sicredi_cnab_config")) out = [cnab];
    else if (path.endsWith("/sicredi_salvar_convenio_223")) {
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
  cnab,
  confirmar_unificacao: true,
};
test("configuração combinada não envia chave e senha existentes ao navegador", async () => {
  backend("gestor");
  const result = await sicrediConfigGet({ data: { accessToken: "fixture-jwt" } });
  expect(result.api_key).toBe("");
  expect(result.password).toBe("");
  expect(result.api_key_configurada).toBe(true);
  expect(result.password_configurada).toBe(true);
  expect(result.cnab?.proximo_nosso_numero).toBe(40);
  expect(JSON.stringify(result)).not.toContain("fixture-private");
});
test("salvamento usa uma única RPC e deriva os dados CNAB dos campos comuns", async () => {
  const calls = backend();
  const result = await sicrediConfigSave({
    data: { ...input, cnab: { ...cnab, cooperativa: "9999", juros_mensal: 99 } },
  });
  const writes = calls.filter((c) => c.method !== "GET" && !c.path.endsWith("consumir_rate_limit"));
  expect(writes).toHaveLength(1);
  expect(writes[0]?.path).toEndWith("/sicredi_salvar_convenio_223");
  expect(writes[0]?.body._actor).toBe(actor);
  expect(writes[0]?.body._cnab).toMatchObject({
    cooperativa: "0165",
    juros_mensal: 2,
    multa_percentual: 3,
  });
  expect(writes[0]?.body._api).not.toHaveProperty("api_key");
  expect(writes[0]?.body._api).not.toHaveProperty("password");
  expect(JSON.stringify(result)).not.toContain("fixture-private");
});
test("gestor consulta mas não salva; juros diários não são convertidos em percentual CNAB", async () => {
  let calls = backend("gestor");
  await expect(sicrediConfigSave({ data: input })).rejects.toThrow("sem permissão");
  expect(calls.some((c) => c.path.endsWith("sicredi_salvar_convenio_223"))).toBe(false);
  calls = backend();
  await expect(sicrediConfigSave({ data: { ...input, tipo_juro: "VALOR" } })).rejects.toThrow(
    "percentual mensal",
  );
  expect(calls.some((c) => c.path.endsWith("sicredi_salvar_convenio_223"))).toBe(false);
});
test("erros de constraints não expõem linhas de configuração com segredos", async () => {
  backend("admin", {
    code: "23514",
    message: "failed row fixture-private-key",
    details: "fixture-private-password",
  });
  await expect(sicrediConfigSave({ data: input })).rejects.toThrow("fase223");
});
