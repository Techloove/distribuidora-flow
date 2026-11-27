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
            { role: "admin", path: "/produtos" },
            { role: "admin", path: "/dashboard" },
          ];
        if (name === "centros") body = [{ id: center, nome: "Ferragens" }];
        if (name === "vw_produtos_lojas_295") body = [{ produto_id: id(50), centro_id: center }];
        if (name === "produtos_consulta_324")
          body = [
            { id: id(50), codigo: "38", descricao: "PREGO", unidade: "KG", estoque_minimo: 0 },
          ];
        if (name === "estoque_minimos_loja_379") {
          assert.equal(req.postDataJSON()._centro, center);
          body = [
            {
              produto_id: id(50),
              estoque_minimo: 50.37,
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
      await page.goto(base + "/produtos");
      await page.getByRole("columnheader", { name: "Estoque mínimo", exact: true }).waitFor();
      await page
        .getByRole("row")
        .filter({ hasText: "PREGO" })
        .getByText("51", { exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Editar registro", exact: true }).first().click();
      await page.getByRole("button", { name: "Preços e estoque", exact: true }).click();
      const minimo = page.locator("#estoque_minimo_calculado");
      assert.equal(await minimo.inputValue(), "51");
      assert.equal(await minimo.isDisabled(), true);
      assert.equal(await page.locator("#estoque_minimo").count(), 0);
      assert.equal(writes.length, 0);
      console.log(
        `OK: ${width}px; mínimo calculado visível na listagem e cadastro, somente leitura.`,
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
