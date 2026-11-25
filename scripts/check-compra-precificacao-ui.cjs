// Somente navegador local com respostas fictícias: nenhum lançamento no banco real.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const { uid, center, rows, rpcs, id } = require("./fixtures/mobile-layout.cjs");
const base = process.env.MOBILE_BASE_URL ?? "http://127.0.0.1:5174";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw Error("Use servidor local");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    for (const width of [1366, 390, 768]) {
      const c = await browser.newContext({ viewport: { width, height: 900 } });

      const writes = [];
      let plano = null;
      let recebimentos = 0;
      await c.addInitScript(
        ({ uid, center }) => {
          localStorage.setItem("erp.centro", center);
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
          );
        },
        { uid, center },
      );
      await c.route("**/*", async (route) => {
        const req = route.request(),
          u = new URL(req.url()),
          name = u.pathname.split("/").pop();
        if (["127.0.0.1", "localhost"].includes(u.hostname)) return route.continue();
        if (u.hostname !== "mobile-fixture.supabase.co") return route.abort();
        let body = rows[name] ?? [];
        if (u.pathname.includes("/rpc/"))
          body =
            rpcs[name] ??
            (name === "meus_centros" ? [center] : name.startsWith("pode_") ? true : []);
        if (name === "user_roles") body = [{ role: "admin" }];
        if (name === "role_menus")
          body = [
            { role: "admin", path: "/compras" },
            { role: "admin", path: "/dashboard" },
          ];
        if (name === "centros") body = [{ id: center, nome: "Ferragens" }];
        if (name === "produtos_consulta_324")
          body = [
            { id: id(50), codigo: "38", descricao: "PREGO", unidade: "KG", estoque_minimo: 0 },
          ];
        if (name === "compras")
          body = [
            {
              id: id(200),
              numero: 2,
              centro_id: center,
              fornecedor_id: id(210),
              status: "rascunho",
              data_entrada: "2026-11-25",
              total_itens: 1150,
              total_liquido: 1150,
              parcelas: 1,
              frete_valor: 0,
              desconto_valor: 0,
            },
          ];
        if (name === "fornecedores") body = [{ id: id(210), razao_social: "Fornecedor teste" }];
        if (name === "compra_itens")
          body = [
            {
              id: id(220),
              compra_id: id(200),
              produto_id: id(50),
              quantidade: 10,
              custo_unitario: 100,
              ipi_percentual: 10,
              frete_unitario: 5,
              total: 1150,
            },
          ];
        if (name === "previa_precificacao_compra_376")
          body = [
            {
              produto_id: id(50),
              descricao: "PREGO",
              preco_atual: 80,
              markup_atual: 60,
              custo_atual: 50,
              custo_novo: 82.5,
              preco_sugerido: 132,
              modo: plano?.modo ?? null,
              valor: plano?.valor ?? null,
            },
          ];
        if (name === "salvar_precificacao_compra_376") {
          const p = req.postDataJSON();
          writes.push(p);
          plano = p._modo ? { modo: p._modo, valor: p._valor } : null;
          body = null;
        }
        if (name === "receber_compra") {
          recebimentos++;
          body = null;
        }
        if (name === "adicionar_item_compra_375") {
          writes.push(req.postDataJSON());
          body = null;
        }
        if (u.pathname === "/auth/v1/user") body = { id: uid, email: "teste@example.invalid" };
        if ((req.headers().accept ?? "").includes("vnd.pgrst.object"))
          body = Array.isArray(body) ? (body[0] ?? {}) : body;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      });
      const page = await c.newPage();
      await page.goto(base + "/compras?aba=entradas");
      await page.getByRole("combobox", { name: "Loja", exact: true }).click();
      await page.getByRole("option", { name: "Ferragens", exact: true }).click();
      await page.locator("tr").filter({ hasText: "Fornecedor teste" }).first().click();
      const linha = page.locator("[data-precificacao-item]");
      await linha.waitFor();
      assert.match(
        await linha.evaluate((el) => el.previousElementSibling.textContent),
        /PREGO/,
        "precificação imediatamente abaixo do item",
      );
      assert.equal(
        await page
          .getByRole("heading", { name: "Custo médio e preço de venda", exact: true })
          .count(),
        0,
        "sem painel separado",
      );
      await page.getByLabel("Valor de venda de PREGO", { exact: true }).fill("50");
      assert.ok(
        await page.getByRole("button", { name: "Receber compra", exact: true }).isDisabled(),
        "rascunho não salvo bloqueia recebimento",
      );
      assert.equal(recebimentos, 0);
      if (width === 1366) {
        const entrada = await page
          .getByLabel("Valor de venda de PREGO", { exact: true })
          .boundingBox();
        const botao = await page
          .getByRole("button", { name: "Salvar preço", exact: true })
          .boundingBox();
        assert.ok(Math.abs(entrada.y - botao.y) < 3, "campos e ação na mesma linha");
      }

      await page.getByRole("button", { name: "Salvar preço", exact: true }).click();
      await page
        .getByText("Preço planejado salvo. Aplicação no recebimento.", { exact: true })
        .waitFor();
      assert.equal(writes[0]._modo, "markup");
      assert.equal(writes[0]._valor, 50);
      await page.getByLabel("Definir preço de PREGO", { exact: true }).selectOption("preco");
      await page.getByLabel("Valor de venda de PREGO", { exact: true }).fill("150");
      await page.getByRole("button", { name: "Salvar preço", exact: true }).click();
      await page
        .getByText("Preço planejado salvo. Aplicação no recebimento.", { exact: true })
        .waitFor();
      assert.equal(writes[1]._modo, "preco");
      assert.equal(writes[1]._valor, 150);
      await page.getByRole("button", { name: "Receber compra", exact: true }).click();
      await page.waitForTimeout(100);
      assert.equal(recebimentos, 1);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        "sem transbordamento",
      );
      console.log(
        `OK: ${width}px; markup/preço salvos no plano; pendência bloqueia recebimento; preço atual informativo; sem escrita antecipada no produto.`,
      );
      await c.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
