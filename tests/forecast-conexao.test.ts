import { expect, test } from "bun:test";
import { testarAcessoForecast } from "../src/lib/server-forecast";
import type { fetchWithTimeout } from "../src/lib/fetch-timeout";

const cnpj = "12345678000195";
test("Forecast usa Basic token: e GET de uma empresa sem retornar dados sensíveis", async () => {
  const transporte: typeof fetchWithTimeout = async (url, init) => {
    expect(url).toBe(`https://forecastfiscal.com.br/api/v2/empresas/${cnpj}`);
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Basic ${btoa("TOKEN-FICTICIO:")}`,
    );
    return Response.json({
      cnpj: "12.345.678/0001-95",
      csc: "NUNCA-RETORNAR",
      token: "TOKEN-REMOTO",
    });
  };
  const r = await testarAcessoForecast("TOKEN-FICTICIO", cnpj, transporte);
  expect(r.sucesso).toBe(true);
  expect(JSON.stringify(r)).not.toContain("NUNCA-RETORNAR");
  expect(JSON.stringify(r)).not.toContain("TOKEN-REMOTO");
});
test("HTTP200 exige CNPJ confirmado; Swagger não define envelope da resposta", async () => {
  for (const body of [
    null,
    [],
    {},
    { cnpj: 123 },
    { cnpj: "99999999000199" },
    { data: { cnpj } },
    { cnpj: ` ${cnpj}` },
  ]) {
    await expect(
      testarAcessoForecast("TOKEN", cnpj, async () => Response.json(body)),
    ).rejects.toThrow("não confirmou o CNPJ");
  }
});
test("erros remotos, JSON inválido e falha de rede não vazam corpo ou token", async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    try {
      await testarAcessoForecast("SEGREDO", cnpj, async () => new Response("SEGREDO", { status }));
      throw new Error("deveria recusar");
    } catch (e) {
      expect((e as Error).message).not.toContain("SEGREDO");
    }
  }
  await expect(
    testarAcessoForecast("TOKEN", cnpj, async () => new Response("<html>")),
  ).rejects.toThrow("não confirmou");
  await expect(
    testarAcessoForecast("TOKEN", cnpj, async () => {
      throw new Error("TOKEN");
    }),
  ).rejects.toThrow("conectividade");
});
test("entrada inválida é recusada antes da chamada externa", async () => {
  let chamadas = 0;
  const transporte: typeof fetchWithTimeout = async () => {
    chamadas++;
    return Response.json({ cnpj });
  };
  for (const token of ["", "Basic abc", "token:senha", "token\n", "á", "x".repeat(2049)])
    await expect(testarAcessoForecast(token, cnpj, transporte)).rejects.toThrow("Token");
  await expect(testarAcessoForecast("TOKEN", "../../", transporte)).rejects.toThrow("CNPJ");
  expect(chamadas).toBe(0);
});
