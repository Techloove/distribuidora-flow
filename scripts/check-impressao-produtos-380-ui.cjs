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
  try {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    );
    const pedido = {
      ...rows.pedidos[0],
      id: id(188),
      numero: 188,
      data_pedido: hoje,
      status: "confirmado",
      centro_id: center,
    };
    const produtos = [21, 26, 12, 32].map((codigo) => ({
      id: id(1000 + codigo),
      codigo: String(codigo),
      descricao: "Produto de teste " + codigo,
      unidade: "KG",
      peso_kg: 1,
    }));
    const itens = produtos.map((p, i) => ({
      ...rows.pedido_itens[0],
      id: id(2000 + i),
      pedido_id: pedido.id,
      produto_id: p.id,
      quantidade: 20,
      preco_unitario: 10,
      total: 200,
    }));
    for (const role of ["representante", "admin"]) {
      let incompleto = false;
      const a = await abrir(role, ({ name, req }) => {
        if (name === "pedidos") return [pedido];
        if (name === "pedido_itens") return itens;
        if (name === "produtos") throw Error("Impressão não deve consultar o catálogo físico");
        if (name === "produtos_impressao_pedidos_380") {
          assert.deepEqual(req.postDataJSON()._pedidos, [pedido.id]);
          return incompleto ? produtos.slice(1) : produtos;
        }
      });
      await a.page.goto(base + "/pedidos");
      await a.page.getByText("#188", { exact: true }).waitFor();
      await a.page
        .getByRole("button", { name: "Imprimir documentos do filtro", exact: true })
        .click();
      const frame = a.page.frameLocator('iframe[title="Prévia de impressão dos documentos"]');
      for (const p of produtos) await frame.getByText(p.descricao, { exact: true }).waitFor();
      assert.equal(await frame.getByText("Produto não informado", { exact: true }).count(), 0);
      await a.page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).click();
      incompleto = true;
      await a.page
        .getByRole("button", { name: "Imprimir documentos do filtro", exact: true })
        .click();
      await a.page.getByText(/A impressão foi interrompida/).waitFor();
      assert.equal(
        await a.page.locator('iframe[title="Prévia de impressão dos documentos"]').count(),
        0,
      );
      console.log(
        `OK: ${role}; códigos21/26/12/32 identificados; catálogo físico não consultado; documento incompleto bloqueado.`,
      );
      await a.context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
