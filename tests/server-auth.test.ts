import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { requireServerAuth } from "../src/lib/server-auth";

const originalFetch = globalThis.fetch;
const originalUrl = process.env["EXT_SUPABASE_URL"];
const originalKey = process.env["EXT_SUPABASE_ANON_KEY"];

describe("requireServerAuth", () => {
  beforeEach(() => {
    process.env["EXT_SUPABASE_URL"] = "https://supabase.example.test";
    process.env["EXT_SUPABASE_ANON_KEY"] = "anon-test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env["EXT_SUPABASE_URL"];
    else process.env["EXT_SUPABASE_URL"] = originalUrl;
    if (originalKey === undefined) delete process.env["EXT_SUPABASE_ANON_KEY"];
    else process.env["EXT_SUPABASE_ANON_KEY"] = originalKey;
  });

  test("rejeita sessão ausente sem chamar serviços externos", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("não deveria chamar");
    }) as typeof fetch;

    await expect(requireServerAuth(undefined, ["admin"])).rejects.toThrow("Sessão não informada");
    expect(called).toBe(false);
  });

  test("valida usuário, perfil ativo e papel autorizado usando o JWT do usuário", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push(url);
      const headers = new Headers(init?.headers);
      expect(headers.get("apikey")).toBe("anon-test-key");
      expect(headers.get("authorization")).toBe("Bearer token-ok");

      if (url.includes("/auth/v1/user")) {
        return Response.json({ id: "00000000-0000-4000-8000-000000000001" });
      }
      if (url.includes("/rest/v1/profiles")) {
        return Response.json([{ ativo: true }]);
      }
      if (url.includes("/rest/v1/user_roles")) {
        return Response.json([{ role: "financeiro" }]);
      }
      throw new Error("endpoint inesperado");
    }) as typeof fetch;

    const user = await requireServerAuth("token-ok", ["admin", "financeiro"]);
    expect(user.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(calls.length).toBe(3);
  });

  test("rejeita usuário inativo, sem papel ou sem papel permitido", async () => {
    let profileActive = false;
    let roles = [{ role: "financeiro" }];

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/auth/v1/user")) {
        return Response.json({ id: "00000000-0000-4000-8000-000000000001" });
      }
      if (url.includes("/rest/v1/profiles")) {
        return Response.json([{ ativo: profileActive }]);
      }
      if (url.includes("/rest/v1/user_roles")) {
        return Response.json(roles);
      }
      throw new Error("endpoint inesperado");
    }) as typeof fetch;

    await expect(requireServerAuth("token-ok", ["financeiro"])).rejects.toThrow("desativado");

    profileActive = true;
    roles = [];
    await expect(requireServerAuth("token-ok", ["financeiro"])).rejects.toThrow("sem papel");

    roles = [{ role: "representante" }];
    await expect(requireServerAuth("token-ok", ["financeiro"])).rejects.toThrow("sem permissão");
  });

  test("rejeita token inválido", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await expect(requireServerAuth("token-invalido", ["admin"])).rejects.toThrow("Sessão inválida");
  });
});
