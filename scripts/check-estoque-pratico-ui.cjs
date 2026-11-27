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
      let saldo = 100;
      const writes = [];
      let leiturasMinimo = 0;
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
            { role: "admin", path: "/estoque" },
            { role: "admin", path: "/dashboard" },
          ];
        if (name === "centros") body = [{ id: center, nome: "Ferragens" }];
        if (name === "produtos_consulta_324")
          body = [
            { id: id(50), codigo: "38", descricao: "PREGO", unidade: "KG", estoque_minimo: 0 },
          ];
        if (name === "estoque_minimos_loja_379") {
          leiturasMinimo++;
          assert.equal(req.postDataJSON()._centro, center);
          body = [
            {
              produto_id: id(50),
              estoque_minimo: 300,
              media_diaria: 10,
              venda_periodo: 900,
              periodo_dias: 90,
              cobertura_dias: 30,
            },
          ];
        }
        if (name === "saldos_estoque_loja_271")
          body = [{ produto_id: id(50), fisico: saldo, reservado: 0, disponivel: saldo }];
        if (["lancar_movimento_estoque", "ajustar_saldo_estoque_374"].includes(name)) {
          const p = req.postDataJSON();
          writes.push({ name, p });
          assert.equal(p._centro_id, center);
          saldo =
            name === "ajustar_saldo_estoque_374"
              ? p._saldo_final
              : saldo + (p._tipo === "saida" ? -1 : 1) * p._quantidade;
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
      await page.goto(base + "/estoque");
      await page.getByRole("combobox", { name: "Loja", exact: true }).click();
      await page.getByRole("option", { name: "Ferragens", exact: true }).click();
      await page.getByRole("combobox", { name: "Selecionar produto" }).click();
      await page.getByRole("option").filter({ hasText: "PREGO" }).click();
      assert.equal(await page.locator("#estoque-loja").count(), 0);
      assert.equal(await page.locator("#estoque-custo").count(), 0);
      await page.locator("#estoque-quantidade").fill("20");
      await page.getByRole("button", { name: "Registrar entrada", exact: true }).click();
      await page.getByText("Movimento lançado", { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector("#estoque-quantidade")?.value === "");
      await page.getByRole("button", { name: "Saída", exact: true }).click();
      await page.locator("#estoque-quantidade").fill("15");
      await page.getByRole("button", { name: "Registrar saída", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("#estoque-quantidade")?.value === "");
      await page.getByRole("button", { name: "Ajuste", exact: true }).click();
      await page.locator("#estoque-quantidade").fill("80");
      await page.getByRole("button", { name: "Registrar ajuste", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("#estoque-quantidade")?.value === "");
      assert.equal(leiturasMinimo, 0, "mínimos só são consultados ao abrir saldos");
      await page.getByRole("tab", { name: "Consultar saldos", exact: true }).click();
      await page.getByText("repor", { exact: true }).waitFor();
      assert.ok(leiturasMinimo > 0);
      const linhaSaldo = page.getByRole("row").filter({ hasText: "PREGO" });
      assert.ok(
        (await linhaSaldo.innerText()).includes("300"),
        "mínimo automático substitui valor manual da fixture",
      );
      await page.getByText(/média dos últimos 90 dias/).waitFor();
      assert.equal(saldo, 80);
      assert.equal(writes.length, 3);
      assert.equal(writes[2].p._saldo_esperado, 105);
      assert.equal(writes[2].p._saldo_final, 80);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        "sem transbordamento horizontal",
      );
      console.log(
        `OK: ${width}px; loja herdada, entrada/saída/ajuste, saldo esperado, mínimo automático sob demanda, sem campos repetidos.`,
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
