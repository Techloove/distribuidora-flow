import test from "node:test";
import assert from "node:assert/strict";
import { authenticateRequest } from "../src/lib/auth.server.ts";

test("server validates identity remotely, rejects inactive profiles, and uses the user JWT for RLS", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.EXT_SUPABASE_URL;
  const originalKey = process.env.EXT_SUPABASE_ANON_KEY;
  process.env.EXT_SUPABASE_URL = "https://supabase.example.test";
  process.env.EXT_SUPABASE_ANON_KEY = "public-test-key";
  let active = true;
  let valid = true;
  let roles = [{ role: "financeiro" }];
  let authCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer user-test-token");
    assert.equal(headers.get("apikey"), "public-test-key");
    if (url.includes("/auth/v1/user")) {
      authCalls++;
      return Response.json(
        valid
          ? { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated" }
          : { message: "invalid token" },
        { status: valid ? 200 : 401 },
      );
    }
    if (url.includes("/rest/v1/profiles")) return Response.json({ ativo: active });
    if (url.includes("/rest/v1/user_roles")) return Response.json(roles);
    throw new Error("Unexpected endpoint: " + url);
  };
  try {
    const result = await authenticateRequest("Bearer user-test-token");
    assert.deepEqual(result.roles, ["financeiro"]);
    assert.equal(authCalls, 1);
    active = false;
    await assert.rejects(authenticateRequest("Bearer user-test-token"), { statusCode: 403 });
    active = true;
    roles = [];
    await assert.rejects(authenticateRequest("Bearer user-test-token"), { statusCode: 403 });
    valid = false;
    await assert.rejects(authenticateRequest("Bearer user-test-token"), { statusCode: 401 });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.EXT_SUPABASE_URL;
    else process.env.EXT_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.EXT_SUPABASE_ANON_KEY;
    else process.env.EXT_SUPABASE_ANON_KEY = originalKey;
  }
});
