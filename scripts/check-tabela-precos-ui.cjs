// Navegador local, autenticação e dados fictícios; nenhuma chamada ao banco real.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const { uid, center, rows, rpcs, id } = require("./fixtures/mobile-layout.cjs");
const base = process.env.MOBILE_BASE_URL ?? "http://127.0.0.1:5174";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Use somente servidor local");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    for (const [width, role] of [
      [1366, "admin"],
      [390, "representante"],
      [768, "representante"],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        hasTouch: width < 1000,
        isMobile: width < 1000,
      });
      await context.addInitScript(
        ({ uid }) =>
          localStorage.setItem(
            "sb-mobile-fixture-auth-token",
            JSON.stringify({
              access_token: "fixture-token",
              refresh_token: "fixture-refresh",
              expires_at: Math.floor(Date.now() / 1000) + 7200,
              expires_in: 7200,
              token_type: "bearer",
              user: {
                id: uid,
                email: "teste@example.invalid",
                aud: "authenticated",
                role: "authenticated",
                app_metadata: {},
                user_metadata: {},
                created_at: "2026-01-01T00:00:00Z",
              },
            }),
          ),
        { uid },
      );
      await context.addInitScript((center) => localStorage.setItem("erp.centro", center), center);
      const outro = id(991);
      let chamadas = 0;
      await context.route("**/*", async (route) => {
        const req = route.request(),
          u = new URL(req.url());
        if (["localhost", "127.0.0.1"].includes(u.hostname)) return route.continue();
        if (u.hostname !== "mobile-fixture.supabase.co") return route.abort();
        const nome = u.pathname.split("/").pop();
        let body = rows[nome] ?? [];
        if (u.pathname.includes("/rpc/"))
          body =
            rpcs[nome] ??
            (nome === "meus_centros" ? [center, outro] : nome.startsWith("pode_") ? true : []);
        if (nome === "user_roles") body = [{ role }];
        if (nome === "role_menus")
          body = [
            { role, path: "/tabela-precos" },
            { role, path: "/dashboard" },
          ];
        if (nome === "centros")
          body = [
            { id: center, nome: "Ferragem teste" },
            { id: outro, nome: "Cimento teste" },
          ];
        if (nome === "tabela_precos_loja_371") {
          chamadas++;
          const loja = JSON.parse(req.postData())._loja;
          const cimento = loja === outro;
          body = {
            loja: { id: loja, nome: cimento ? "Cimento teste" : "Ferragem teste" },
            consultado_em: "2026-11-18T13:00:00Z",
            faixas: cimento
              ? []
              : Array.from({ length: 7 }, (_, i) => ({
                  id: id(600 + i),
                  nome: "Faixa " + (i + 1),
                  percentual: i + 1,
                  peso_min: i * 1000,
                  peso_max: null,
                  categoria: null,
                  ordem: i,
                  ativo: true,
                })),
            itens: Array.from({ length: 35 }, (_, i) => ({
              id: id(700 + i),
              codigo: String(i + 1),
              descricao:
                (cimento ? "Cimento" : "Ferro") + " item " + String(i + 1).padStart(2, "0"),
              unidade: "UN",
              categoria: "Categoria",
              peso_kg: 10,
              preco_normal: 100,
            })),
          };
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
      const page = await context.newPage(),
        erros = [];
      page.on("pageerror", (e) => erros.push(e.message));
      await page.goto(base + "/tabela-precos", { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Tabela de preços", exact: true }).waitFor();
      const main = page.getByRole("main");
      await main.getByRole("combobox", { name: "Loja da tabela de preços" }).click();
      await page.getByRole("option", { name: "Ferragem teste", exact: true }).click();
      await page.getByText("Página 1 de 2", { exact: false }).waitFor();
      await main.getByRole("combobox", { name: "Formato da tabela de preços" }).click();
      await page
        .getByRole("option", { name: "Preço normal e faixas por peso", exact: true })
        .click();
      await main
        .locator("th:visible, article p:visible")
        .filter({ hasText: /Faixa 7 ·/ })
        .first()
        .waitFor();
      assert.ok(
        (await page.evaluate(() => document.documentElement.scrollWidth)) <= width + 1,
        "Sem overflow da página",
      );
      await main.getByRole("button", { name: "Próxima", exact: true }).click();
      await main.getByText("Página 2 de 2", { exact: false }).waitFor();
      await main.getByRole("button", { name: "Imprimir / salvar PDF", exact: true }).click();
      const iframe = page.frameLocator('iframe[title="Prévia da tabela de preços"]');
      await iframe
        .getByRole("heading", { name: "Tabela de preços · Ferragem teste" })
        .first()
        .waitFor();
      assert.equal(await iframe.locator("section").count(), 3);
      assert.equal(
        await iframe.locator("tbody tr").count(),
        105,
        "Impressão inclui os 35 produtos nos três blocos",
      );
      await page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).click();
      await main.getByPlaceholder("Código, descrição ou categoria").fill("item 35");
      await main.getByText("Página 1 de 1", { exact: false }).waitFor();
      fs.mkdirSync("/tmp/tabela-precos-ui", { recursive: true });
      await page.screenshot({ path: `/tmp/tabela-precos-ui/${width}.png`, fullPage: true });
      await main.getByRole("combobox", { name: "Loja da tabela de preços" }).click();
      await page.getByRole("option", { name: "Cimento teste", exact: true }).click();
      await main
        .locator("td:visible, article p:visible")
        .filter({ hasText: /^Cimento item 01$/ })
        .first()
        .waitFor();
      assert.equal(await main.getByText("Ferro item 35", { exact: true }).count(), 0);
      assert.ok(chamadas >= 2);
      assert.deepEqual(erros, []);
      console.log(
        `${width}px ${role}: faixas dinâmicas, busca, paginação, PDF completo e troca de loja OK`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
