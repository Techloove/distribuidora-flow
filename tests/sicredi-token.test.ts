import { afterEach, expect, mock, test } from "bun:test";
import { tokenSicredi } from "../src/lib/sicredi-token";
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const config = {
  base: "https://fixture.bank.test",
  apiKey: "key",
  username: "user",
  password: "password",
  cooperativa: "0165",
  posto: "02",
  beneficiario: "00623",
};
test("token persistido é reutilizado sem autenticar novamente", async () => {
  let value: string | undefined;
  const forms: Record<string, string>[] = [];
  const rpc = mock(async (name: string, p: Record<string, unknown>) => {
    if (name === "sicredi_token_reservar_224")
      return value ? { access_token: value } : { lease: "fixture-lease" };
    value = (p._dados as Record<string, string>)?.access_token;
    return null;
  });
  globalThis.fetch = mock(async (_i: RequestInfo | URL, init?: RequestInit) => {
    forms.push(Object.fromEntries(init?.body as URLSearchParams));
    return new Response(
      JSON.stringify({
        access_token: "access-fixture",
        expires_in: 300,
        refresh_token: "refresh-fixture",
        refresh_expires_in: 900,
      }),
    );
  }) as typeof fetch;
  expect(await tokenSicredi(config, rpc as never)).toBe("access-fixture");
  expect(await tokenSicredi(config, rpc as never)).toBe("access-fixture");
  expect(forms).toHaveLength(1);
  expect(forms[0]?.grant_type).toBe("password");
});
test("renovação usa refresh_token sem enviar usuário e senha", async () => {
  let form: Record<string, string> = {};
  const rpc = mock(async (name: string) =>
    name === "sicredi_token_reservar_224"
      ? { lease: "fixture-lease", refresh_token: "refresh-fixture" }
      : null,
  );
  globalThis.fetch = mock(async (_i: RequestInfo | URL, init?: RequestInit) => {
    form = Object.fromEntries(init?.body as URLSearchParams);
    return new Response(
      JSON.stringify({
        access_token: "renewed-fixture",
        expires_in: 300,
        refresh_token: "next-refresh-fixture",
        refresh_expires_in: 900,
      }),
    );
  }) as typeof fetch;
  expect(await tokenSicredi(config, rpc as never)).toBe("renewed-fixture");
  expect(form).toEqual({ grant_type: "refresh_token", refresh_token: "refresh-fixture" });
});
test("renovação recusada volta a password uma vez; erro5xx não faz autenticação extra", async () => {
  for (const status of [400, 503]) {
    const forms: Record<string, string>[] = [];
    const rpc = mock(async (name: string) =>
      name === "sicredi_token_reservar_224"
        ? { lease: "fixture-lease", refresh_token: "refresh-fixture" }
        : null,
    );
    globalThis.fetch = mock(async (_i: RequestInfo | URL, init?: RequestInit) => {
      forms.push(Object.fromEntries(init?.body as URLSearchParams));
      return forms.length === 1
        ? new Response("{}", { status })
        : new Response(JSON.stringify({ access_token: "new-fixture", expires_in: 300 }));
    }) as typeof fetch;
    if (status === 400) {
      expect(await tokenSicredi(config, rpc as never)).toBe("new-fixture");
      expect(forms[1]?.grant_type).toBe("password");
    } else {
      await expect(tokenSicredi(config, rpc as never)).rejects.toThrow("503");
      expect(forms).toHaveLength(1);
      expect(
        rpc.mock.calls.some(
          (args) => (args[1] as Record<string, unknown> | undefined)?._dados === null,
        ),
      ).toBe(true);
    }
  }
});
test("chave de cache muda por credenciais e ambiente e não contém segredos", async () => {
  const hashes: string[] = [];
  const rpc = mock(async (_name: string, p: Record<string, unknown>) => {
    hashes.push(String(p._chave));
    return { access_token: "cached-fixture" };
  });
  await tokenSicredi(config, rpc as never);
  await tokenSicredi({ ...config, password: "new-password" }, rpc as never);
  await tokenSicredi({ ...config, base: "https://fixture.bank.test/sb" }, rpc as never);
  expect(new Set(hashes).size).toBe(3);
  for (const key of hashes) expect(key).toMatch(/^[a-f0-9]{64}$/);
});
test("resposta sem prazo válido é rejeitada e libera reserva", async () => {
  const rpc = mock(async (name: string) =>
    name === "sicredi_token_reservar_224" ? { lease: "fixture-lease" } : null,
  );
  globalThis.fetch = mock(
    async () => new Response(JSON.stringify({ access_token: "secret-fixture", expires_in: 0 })),
  ) as typeof fetch;
  await expect(tokenSicredi(config, rpc as never)).rejects.toThrow("prazo");
  expect(
    rpc.mock.calls.some(
      (args) => (args[1] as Record<string, unknown> | undefined)?._dados === null,
    ),
  ).toBe(true);
});

test("instâncias concorrentes esperam a reserva e reutilizam o token do vencedor", async () => {
  let cached: string | undefined,
    leased = false,
    auth = 0,
    busy = 0,
    release: (() => void) | undefined;
  const rpc = mock(async (name: string, p: Record<string, unknown>) => {
    if (name === "sicredi_token_reservar_224") {
      if (cached) return { access_token: cached };
      if (leased) {
        busy++;
        release?.();
        return { busy: true };
      }
      leased = true;
      return { lease: "fixture-lease" };
    }
    cached = (p._dados as Record<string, string>)?.access_token;
    leased = false;
    return null;
  });
  globalThis.fetch = mock(async () => {
    auth++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return new Response(JSON.stringify({ access_token: "one-token", expires_in: 300 }));
  }) as typeof fetch;
  expect(
    await Promise.all([tokenSicredi(config, rpc as never), tokenSicredi(config, rpc as never)]),
  ).toEqual(["one-token", "one-token"]);
  expect(auth).toBe(1);
  expect(busy).toBeGreaterThan(0);
});
