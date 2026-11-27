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
  const abrir = async (role, extra, width = 1366) => {
    const context = await browser.newContext({ viewport: { width, height: 900 } }),
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
    for (const [width, status] of [
      [1366, "rascunho"],
      [1366, "confirmado"],
      [390, "confirmado"],
      [768, "confirmado"],
    ]) {
      const produto = {
        ...rows.produtos[0],
        id: id(50),
        codigo: "42",
        descricao: "ARAME DE TESTE",
        preco_venda: 9.95,
        unidade: "KG",
      };
      let preco = 9.95;
      const historico = [];
      const saves = [];
      const pedido = {
        ...rows.pedidos[0],
        id: id(188),
        numero: 188,
        status,
        tipo_documento: "pedido",
        modalidade_venda: "estoque",
        data_pedido: hoje,
        total_itens: 3582,
        total_liquido: 3582,
      };
      const item = {
        ...rows.pedido_itens[0],
        id: id(30),
        pedido_id: pedido.id,
        produto_id: produto.id,
        quantidade: 400,
        preco_unitario: preco,
        desconto_percentual: 10,
        total: 3582,
      };
      const a = await abrir(
        "admin",
        ({ name, req }) => {
          if (name === "pedidos") return [pedido];
          if (name === "pedido_itens") return [{ ...item, preco_unitario: preco }];
          if (name === "produtos_consulta_324") return [produto];
          if (
            ["acompanhar_pedido_269", "acompanhar_pedido_236", "acompanhar_pedido_235"].includes(
              name,
            )
          )
            return { ...pedido, status: pedido.status };
          if (name === "pedido_item_precos_381") return historico;
          if (name === "atualizar_item_pedido_parcial_381") {
            const p = req.postDataJSON();
            assert.equal(p._preco_unitario, null);
            assert.equal(p._desconto_percentual, null);
            item.quantidade = p._quantidade;
            item.total = Math.round(item.quantidade * preco * 0.9 * 100) / 100;
            pedido.total_itens = item.total;
            pedido.total_liquido = item.total;
            return null;
          }
          if (name === "negociar_preco_item_381") {
            const p = req.postDataJSON();
            saves.push(p);
            assert.equal(p._item, item.id);
            assert.equal(p._preco_esperado, 9.95);
            assert.equal(p._novo_preco, 9.5);
            preco = p._novo_preco;
            historico.push({
              id: id(381),
              item_id: item.id,
              preco_anterior: 9.95,
              preco_novo: 9.5,
              motivo: p._motivo,
              alterado_em: new Date().toISOString(),
            });
            item.total = 3420;
            pedido.total_itens = 3420;
            pedido.total_liquido = 3420;
            return null;
          }
        },
        width,
      );
      a.page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
      await a.page.goto(base + "/pedidos");
      await a.page.getByRole("combobox", { name: "Loja", exact: true }).click();
      await a.page.getByRole("option", { name: "Ferragens", exact: true }).click();
      await a.page.getByText("#188", { exact: true }).click();
      await a.page
        .getByRole("button", { name: "Negociar preço", exact: true })
        .waitFor({ timeout: 8000 })
        .catch(async (e) => {
          console.log("DEBUG", (await a.page.locator("body").innerText()).slice(-9000));
          throw e;
        });
      await a.page.getByRole("button", { name: "Negociar preço", exact: true }).click();
      const dialog = a.page.getByRole("dialog");
      await dialog.getByLabel("Novo preço unitário", { exact: true }).fill("9,50");
      await dialog.getByText("R$ 3.420,00", { exact: true }).waitFor();
      await dialog.getByLabel("Motivo (opcional)", { exact: true }).fill("Negociação especial");
      await dialog.getByRole("button", { name: "Aplicar novo preço", exact: true }).click();
      await a.page.getByText("Preço negociado salvo no pedido.", { exact: true }).waitFor();
      await a.page.getByText(/Antes:.*Novo:/).waitFor();
      assert.equal(saves.length, 1);
      assert.equal(item.quantidade, 400);
      assert.equal(item.desconto_percentual, 10);
      assert.equal(produto.preco_venda, 9.95);
      if (status === "rascunho") {
        await a.page.getByLabel("Quantidade de ARAME DE TESTE", { exact: true }).fill("300");
        await a.page.getByLabel("Quantidade de ARAME DE TESTE", { exact: true }).press("Tab");
        await a.page.waitForFunction(() => document.body.textContent.includes("2.565,00"));
        assert.equal(item.quantidade, 300);
      }
      pedido.status = "cancelado";
      await a.page.reload();
      await a.page.getByText("#188", { exact: true }).click();
      await a.page.getByRole("button", { name: "Ver negociação", exact: true }).click();
      const leitura = a.page.getByRole("dialog");
      await leitura
        .getByRole("heading", { name: "Histórico do preço do item", exact: true })
        .waitFor();
      assert.equal(await leitura.getByLabel("Novo preço unitário", { exact: true }).count(), 0);
      assert.equal(
        await leitura.getByRole("button", { name: "Aplicar novo preço", exact: true }).count(),
        0,
      );

      assert.ok(
        await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        "sem transbordamento",
      );
      console.log(
        `OK: ${width}px; admin negocia preço9,95→9,50 com prévia, antes/depois persistidos e quantidade/desconto/catálogo preservados.`,
      );
      await a.context.close();
    }
    const rep = await abrir("representante", ({ name }) => {
      if (name === "pedidos") return [{ ...rows.pedidos[0], data_pedido: hoje }];
    });
    await rep.page.goto(base + "/pedidos");
    await rep.page.getByRole("combobox", { name: "Loja", exact: true }).click();
    await rep.page.getByRole("option", { name: "Ferragens", exact: true }).click();
    await rep.page.getByText("#" + rows.pedidos[0].numero, { exact: true }).click();
    await rep.page.getByRole("button", { name: /Voltar à lista/ }).waitFor();
    assert.equal(
      await rep.page.getByRole("button", { name: "Negociar preço", exact: true }).count(),
      0,
    );
    await rep.context.close();
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
