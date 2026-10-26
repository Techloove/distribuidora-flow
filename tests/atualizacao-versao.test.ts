import { test, expect } from "bun:test";
import {
  versaoMaisNova,
  podeAtualizarNaEntrada,
  consultarAtualizacao,
  urlDaAtualizacao,
} from "../src/lib/atualizacao-versao";
test("avisa somente uma versão realmente mais nova, comparando partes numericamente", () => {
  for (const [nova, atual] of [
    ["1.1.0", "1.0.9"],
    ["1.10.0", "1.9.99"],
    ["2.0.0", "1.99.99"],
    ["1.1.1", "1.1.0"],
  ])
    expect(versaoMaisNova(nova!, atual!)).toBe(true);
  for (const [nova, atual] of [
    ["1.1.0", "1.1.0"],
    ["1.0.9", "1.1.0"],
    ["1.09.0", "1.0.0"],
    ["beta", "1.0.0"],
    ["1.0.0", "invalida"],
    ["https://fora.invalid", "1.0.0"],
  ])
    expect(versaoMaisNova(nova!, atual!)).toBe(false);
});
test("consulta metadados sem cache, sem credenciais e sem seguir redirecionamentos", async () => {
  const transporte = (async (url, init) => {
    expect(String(url)).toMatch(/^\/versao\.json\?consulta=\d+$/);
    expect(init?.cache).toBe("no-store");
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeDefined();
    expect(init?.method).toBeUndefined();
    return Response.json({
      versao: "1.2.0",
      data: "2026-10-26",
      titulo: "Nova funcionalidade",
      token: "NÃO RETORNAR",
    });
  }) as typeof fetch;
  expect(await consultarAtualizacao("1.1.0", transporte)).toEqual({
    versao: "1.2.0",
    data: "2026-10-26",
    titulo: "Nova funcionalidade",
  });
});
test("publicação que muda durante a sessão é detectada na consulta seguinte", async () => {
  let versao = "1.1.0";
  const transporte = (async () =>
    Response.json({ versao, data: "2026-10-26", titulo: "Atualização" })) as typeof fetch;
  expect(await consultarAtualizacao("1.1.0", transporte)).toBeNull();
  versao = "1.2.0";
  expect((await consultarAtualizacao("1.1.0", transporte))?.versao).toBe("1.2.0");
});
test("indisponibilidade, página HTML e manifesto inválido não geram falso aviso", async () => {
  const respostas = [
    () => new Response("Falha", { status: 503 }),
    () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
    () => new Response("{malformado", { headers: { "content-type": "application/json" } }),
    () => Response.json({ versao: "1.2.0" }),
    () => Response.json({ versao: "1.1.0", data: "2026-10-26", titulo: "Igual" }),
    () => Response.json({ versao: "1.0.0", data: "2026-10-26", titulo: "Anterior" }),
    () => new Response("x".repeat(5000), { headers: { "content-type": "application/json" } }),
    () =>
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "5000" },
      }),
  ];
  for (const resposta of respostas)
    expect(
      await consultarAtualizacao("1.1.0", (async () => resposta()) as typeof fetch),
    ).toBeNull();
  expect(
    await consultarAtualizacao("1.1.0", (async () => {
      throw new Error("offline");
    }) as typeof fetch),
  ).toBeNull();
});
test("atualização conserva tela, filtros e âncora e muda apenas o identificador de cache", () => {
  const url = new URL(
    urlDaAtualizacao(
      "https://caparao.example/pedidos?pedido=abc&_atualizacao=1.0.0#itens",
      "1.2.0",
    ),
  );
  expect(url.origin).toBe("https://caparao.example");
  expect(url.pathname).toBe("/pedidos");
  expect(url.searchParams.get("pedido")).toBe("abc");
  expect(url.searchParams.getAll("_atualizacao")).toEqual(["1.2.0"]);
  expect(url.hash).toBe("#itens");
  expect(() => urlDaAtualizacao(url.toString(), "javascript:alert(1)")).toThrow();
});

test("na entrada permite atualizar uma vez e bloqueia ciclos, inclusive se storage não estiver disponível", () => {
  const inicio = "https://caparao.example/pedidos?pedido=abc";
  expect(podeAtualizarNaEntrada(inicio, "1.1.0", "1.2.0", null)).toBe(true);
  expect(podeAtualizarNaEntrada(inicio, "1.1.0", "1.2.0", "1.1.0->1.2.0")).toBe(false);
  expect(podeAtualizarNaEntrada(urlDaAtualizacao(inicio, "1.2.0"), "1.1.0", "1.2.0", null)).toBe(
    false,
  );
  expect(podeAtualizarNaEntrada(inicio, "1.2.0", "1.2.0", null)).toBe(false);
  expect(podeAtualizarNaEntrada(inicio, "1.2.0", "1.1.0", null)).toBe(false);
  expect(podeAtualizarNaEntrada(inicio, "1.1.0", "1.3.0", "1.1.0->1.2.0")).toBe(true);
});
