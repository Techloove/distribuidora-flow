import { expect, test } from "bun:test";
import { testarAcessoFaznotas } from "../src/lib/server-faznotas";
import type { fetchWithTimeout } from "../src/lib/fetch-timeout";

test("teste FAZNOTAS usa somente GET paginado e não devolve token ou catálogo", async () => {
  const transporte: typeof fetchWithTimeout = async (url, init) => {
    expect(String(url)).toBe(
      "https://api.mysebr.com.br/nfemyse-v3/rest/produtos?page=1&page_size=1",
    );
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.headers).toEqual({
      Authorization: "Token segredo-ficticio",
      Accept: "application/json",
    });
    expect(init?.redirect).toBe("error");
    return Response.json({
      status: "005",
      data: [{ referencia: "CATALOGO-PRIVADO" }],
      token: "segredo-ficticio",
    });
  };
  const resultado = await testarAcessoFaznotas("segredo-ficticio", transporte);
  expect(resultado.sucesso).toBe(true);
  expect(JSON.stringify(resultado)).not.toContain("segredo-ficticio");
  expect(JSON.stringify(resultado)).not.toContain("CATALOGO-PRIVADO");
});
test("HTTP200 sem confirmação da API não é autenticação confirmada", async () => {
  for (const status of ["400", "999", "001", undefined]) {
    await expect(
      testarAcessoFaznotas("ficticio", async () => Response.json({ status })),
    ).rejects.toThrow("não confirmou");
  }
});
test("credencial recusada e limite retornam mensagens sem corpo sensível", async () => {
  for (const status of [401, 403])
    await expect(
      testarAcessoFaznotas("ficticio", async () => new Response("segredo", { status })),
    ).rejects.toThrow("recusou o token");
  await expect(
    testarAcessoFaznotas("ficticio", async () => new Response("segredo", { status: 429 })),
  ).rejects.toThrow("Limite");
});
