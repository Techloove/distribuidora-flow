import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { requireServerAuth } from "../src/lib/server-auth";

const originalFetch = globalThis.fetch;
const keys = ["EXT_SUPABASE_URL", "EXT_SUPABASE_ANON_KEY"];
const previous = keys.map((key) => process.env[key]);
beforeAll(() => {
  process.env.EXT_SUPABASE_URL = "https://fixture.supabase.test";
  process.env.EXT_SUPABASE_ANON_KEY = "fixture-public";
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
function backend(profile: Record<string, unknown>, role = "representante") {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    let out: unknown;
    if (url.pathname.endsWith("/user")) out = { id: "fixture-user" };
    else if (url.pathname.endsWith("/profiles")) {
      expect(url.searchParams.get("select")).toContain("precisa_completar_cadastro");
      out = [profile];
    } else if (url.pathname.endsWith("/user_roles")) out = [{ role }];
    else throw new Error("Requisição inesperada " + url.pathname);
    return new Response(JSON.stringify(out));
  }) as typeof fetch;
}
test("servidor bloqueia cadastro incompleto mesmo com papel autorizado", async () => {
  backend({ ativo: true, precisa_completar_cadastro: true }, "admin");
  await expect(requireServerAuth("fixture-jwt", ["admin"])).rejects.toThrow(
    "Complete seu cadastro",
  );
});
test("cadastro completo mantém a autorização do servidor por papel", async () => {
  backend({ ativo: true, precisa_completar_cadastro: false });
  expect(await requireServerAuth("fixture-jwt", ["representante"])).toEqual({ id: "fixture-user" });
  await expect(requireServerAuth("fixture-jwt", ["admin"])).rejects.toThrow("sem permissão");
});
test("aprovação continua obrigatória antes do complemento", async () => {
  backend({ ativo: false, precisa_completar_cadastro: false });
  await expect(requireServerAuth("fixture-jwt", ["representante"])).rejects.toThrow(
    "aguardando liberação",
  );
});
