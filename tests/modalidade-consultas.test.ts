import { test, expect } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import {
  clienteAnalitico,
  destinoModalidade,
  fetchModalidade,
} from "../src/lib/modalidade-consultas";
import { normalizarModalidade, nomesModalidade } from "../src/lib/modalidade-store";
const url = (path: string) => new URL("https://fixture.invalid/rest/v1/" + path);
test("filtro aplica antes de paginação e conserva filtros de loja/período", () => {
  const u = destinoModalidade(
    url("pedidos?centro_id=eq.loja&limit=50&offset=100&data_pedido=gte.2026-10-01"),
    "GET",
    "intermediacao",
  );
  expect(u.pathname).toEndWith("/pedidos_mod_300");
  expect(u.searchParams.get("offset")).toBe("100");
  expect(u.searchParams.get("centro_id")).toBe("eq.loja");
  expect(destinoModalidade(url("vw_dre_base"), "GET", "estoque").pathname).toEndWith(
    "/vw_dre_base_mod_300",
  );
  expect(destinoModalidade(url("rpc/dashboard_financeiro"), "POST", "estoque").pathname).toEndWith(
    "/dashboard_financeiro_mod_300",
  );
});
test("Todos, detalhes, cadastros, estoque físico e gravações preservam origem", () => {
  for (const [p, m, v] of [
    ["pedidos", "GET", "todos"],
    ["pedidos?id=eq.um", "GET", "intermediacao"],
    ["pedido_itens?pedido_id=eq.um", "GET", "estoque"],
    ["pedidos", "PATCH", "intermediacao"],
    ["pedidos", "POST", "estoque"],
    ["produtos", "GET", "estoque"],
    ["rpc/confirmar_pedido", "POST", "intermediacao"],
    ["vw_planejamento_compras_294", "GET", "intermediacao"],
  ]) {
    const u = url(p!);
    expect(destinoModalidade(u, m!, v!).toString()).toBe(u.toString());
  }
  expect(normalizarModalidade("qualquer")).toBe("todos");
  expect(nomesModalidade.estoque).toBe("Vendas Estoque");
  expect(nomesModalidade.intermediacao).toBe("Vendas Intermediação");
});
test("cliente de análise não marca insert/update/delete, nem devoluções de gravações", async () => {
  const pedidos: Request[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const r = new Request(input, init);
    pedidos.push(r);
    return new Response("[]", { headers: { "content-type": "application/json" } });
  };
  try {
    const base = createClient("https://fixture.invalid", "anon-fixture", {
      global: { fetch: fetchModalidade },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const client = clienteAnalitico(base, "intermediacao");
    await client.from("pedidos").select("*").eq("centro_id", "loja");
    await client.from("pedidos").update({ observacoes: "teste" }).eq("id", "p").select("*");
    await client.rpc("confirmar_pedido", { _pedido: "p" });
    await client.rpc("dashboard_financeiro", { _centro: "loja" });
    expect(new URL(pedidos[0]!.url).pathname).toEndWith("/pedidos_mod_300");
    expect(new URL(pedidos[1]!.url).pathname).toEndWith("/pedidos");
    expect(pedidos[1]!.headers.has("x-modalidade-venda")).toBe(false);
    expect(new URL(pedidos[2]!.url).pathname).toEndWith("/rpc/confirmar_pedido");
    expect(pedidos[2]!.headers.has("x-modalidade-venda")).toBe(false);
    expect(new URL(pedidos[3]!.url).pathname).toEndWith("/rpc/dashboard_financeiro_mod_300");
  } finally {
    globalThis.fetch = original;
  }
});
