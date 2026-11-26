// Auditoria local de rede: respostas fictícias, nenhuma conexão com dados de produção.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const { uid, center, rows, rpcs, id } = require("./fixtures/mobile-layout.cjs");
const base = process.env.MOBILE_BASE_URL ?? "http://127.0.0.1:5174";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Somente servidor local");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const abrir = async (role, extra) => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } }),
      requests = [];
    await context.addInitScript(
      ({ uid }) =>
        localStorage.setItem(
          "sb-mobile-fixture-auth-token",
          JSON.stringify({
            access_token: "fixture-token",
            refresh_token: "fixture-refresh",
            expires_at: Math.floor(Date.now() / 1000) + 7200,
            token_type: "bearer",
            user: {
              id: uid,
              email: "teste@example.invalid",
              aud: "authenticated",
              role: "authenticated",
              app_metadata: {},
              user_metadata: {},
            },
          }),
        ),
      { uid },
    );
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        name = u.pathname.split("/").pop();
      if (["localhost", "127.0.0.1"].includes(u.hostname)) return route.continue();
      if (u.hostname !== "mobile-fixture.supabase.co") return route.abort();
      requests.push({ name, url: u, method: req.method() });
      let body = rows[name] ?? [];
      if (u.pathname.includes("/rpc/"))
        body =
          rpcs[name] ?? (name === "meus_centros" ? [center] : name.startsWith("pode_") ? true : []);
      if (name === "user_roles") body = [{ role }];
      if (name === "role_menus")
        body = ["/pedidos", "/compras", "/boletos", "/dashboard"].map((path) => ({ role, path }));
      if (name === "minhas_permissoes") body = role === "financeiro" ? [] : rpcs.minhas_permissoes;
      if (name === "centros") body = [{ id: center, nome: "Ferragens" }];
      const result = extra({ name, u, req, body });
      if (result !== undefined) body = result;
      if (u.pathname === "/auth/v1/user") body = { id: uid, email: "teste@example.invalid" };
      if ((req.headers().accept ?? "").includes("vnd.pgrst.object"))
        body = Array.isArray(body) ? (body[0] ?? {}) : body;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    return { context, page: await context.newPage(), requests };
  };
  let acessoRevogado = false;
  try {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    );
    const pedido = {
      ...rows.pedidos[0],
      id: id(800),
      numero: 800,
      tipo_documento: "pedido",
      status: "confirmado",
      data_pedido: hoje,
      centro_id: center,
      representante_id: id(40),
      total_itens: 100,
      total_liquido: 100,
    };
    const itens = Array.from({ length: 1001 }, (_, i) => ({
      ...rows.pedido_itens[0],
      id: id(10000 + i),
      pedido_id: pedido.id,
      produto_id: id(50),
      quantidade: 1,
      total: 1,
    }));
    const a = await abrir("representante", ({ name, u }) => {
      if (name === "pedidos") return [pedido];
      if (name === "role_menus" && acessoRevogado) return [];
      if (name === "pedido_itens") {
        const offset = Number(u.searchParams.get("offset") ?? 0),
          limit = Number(u.searchParams.get("limit") ?? 1000);
        return itens.slice(offset, offset + limit);
      }
    });
    const erros = [];
    a.page.on("pageerror", (e) => erros.push(e.message));
    await a.page.clock.install();
    await a.page.goto(base + "/pedidos");
    await a.page.getByText("#800", { exact: true }).waitFor();
    assert.equal(
      a.requests.filter(
        (r) => r.name === "produtos_consulta_324" || r.name === "vw_produto_comprado",
      ).length,
      0,
      "lista não carrega catálogo nem comprado",
    );
    assert.ok(
      a.requests
        .filter((r) => r.name === "pedidos")
        .every(
          (r) =>
            r.url.searchParams.getAll("data_pedido").some((v) => v.startsWith("gte.")) &&
            r.url.searchParams.getAll("data_pedido").some((v) => v.startsWith("lte.")),
        ),
      "período aplicado na consulta do banco",
    );
    const before = (n) => a.requests.filter((r) => r.name === n).length;
    const menus = before("role_menus"),
      perms = before("minhas_permissoes");
    await a.page.clock.runFor(31_000);
    await a.page.waitForTimeout(100);
    assert.equal(before("role_menus") - menus, 1, "uma atualização de menus por ciclo");
    assert.equal(before("minhas_permissoes") - perms, 1, "uma atualização de ações por ciclo");
    await a.page.getByText("#800", { exact: true }).click();
    await a.page.waitForFunction(
      () => document.querySelectorAll("table.mobile-cards tbody tr").length >= 1001,
    );
    assert.deepEqual(
      a.requests
        .filter((r) => r.name === "pedido_itens")
        .map((r) => Number(r.url.searchParams.get("offset") ?? 0)),
      [0, 500, 1000],
      "itens lidos em páginas sem truncar",
    );
    assert.ok(before("produtos_consulta_324") > 0, "catálogo disponível ao abrir documento");
    assert.ok(
      a.requests
        .filter((r) => r.name === "vw_produto_comprado")
        .every((r) => r.url.searchParams.get("centro_id") === "eq." + center),
      "compras pendentes consultadas na loja do documento",
    );

    await a.page
      .getByText(/Não foi possível consultar as datas do pedido/)
      .first()
      .waitFor();
    assert.deepEqual(erros, [], "resposta de datas incompleta não derruba a tela");
    acessoRevogado = true;
    await a.page.clock.runFor(31_000);
    await a.page.getByRole("heading", { name: "Acesso ao sistema", exact: true }).waitFor();
    acessoRevogado = false;
    await a.page.clock.runFor(31_000);
    await a.page.getByText("#800", { exact: true }).waitFor();
    await a.context.close();
    console.log(
      "OK: lista sem catálogo; período no servidor; uma atualização por ciclo de permissões; 1.001 itens completos.",
    );
    const b = await abrir("admin", () => undefined);
    await b.page.goto(base + "/compras?aba=entradas");
    await b.page.getByText("Importar XML de compra", { exact: true }).waitFor();
    await b.page.waitForTimeout(100);
    assert.equal(
      b.requests.filter((r) => r.name === "produtos_consulta_324").length,
      0,
      "XML fechado e lista não carregam catálogo",
    );
    await b.page.getByText("Importar XML de compra", { exact: true }).click();
    await b.page.waitForTimeout(100);
    assert.ok(
      b.requests.some((r) => r.name === "produtos_consulta_324"),
      "abrir XML carrega opções",
    );
    await b.context.close();
    console.log("OK: opções do XML carregadas somente ao abrir a seção.");
    const c = await abrir("financeiro", ({ name }) => {
      if (name === "cobranca_centros") return { banco: "sicoob", canal: "api", ativo: true };
      if (name === "boletos")
        return [
          {
            id: id(900),
            centro_id: center,
            cliente_id: id(20),
            nosso_numero: "3850",
            banco: "sicoob",
            canal: "api",
            ambiente: "producao",
            status: "registrado",
            valor: 25,
            vencimento: "2026-12-20",
          },
        ];
    });
    await c.page.goto(base + "/boletos");
    await c.page.getByRole("combobox", { name: "Loja", exact: true }).click();
    await c.page.getByRole("option", { name: "Ferragens", exact: true }).click();
    await c.page.locator("table tbody tr").filter({ hasText: "3850" }).first().waitFor();
    await c.page.waitForTimeout(100);
    assert.equal(
      c.requests.filter((r) => /^sicredi_tarifas|^sicredi_cnab/.test(r.name)).length,
      0,
      "loja somente Sicoob não lê tarifas/CNAB Sicredi",
    );
    await c.context.close();
    console.log("OK: Sicoob sem consultas de tarifas ou CNAB do Sicredi.");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
