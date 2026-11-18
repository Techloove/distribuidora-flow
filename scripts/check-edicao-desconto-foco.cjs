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
      [390, "admin"],
      [768, "admin"],
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
      let escritas = 0;
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
            (nome === "meus_centros" ? [center] : nome.startsWith("pode_") ? true : []);
        if (nome === "centros") body = [{ id: center, nome: "Ferragens", ativo: true }];
        if (nome === "desconto_faixas_peso") {
          if (req.method() !== "GET") escritas++;
          body = [
            {
              id: id(701),
              centro_id: center,
              nome: "Desconto por peso",
              categoria: null,
              peso_min: 1000,
              peso_max: 2000,
              percentual: 3,
              ordem: 1,
              ativo: true,
            },
          ];
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
      await page.goto(base + "/descontos-peso", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Editar registro", exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      const titulo = dialog.getByRole("heading", { name: "Editar registro", exact: true });
      await titulo.waitFor();
      assert.equal(
        await titulo.evaluate((el) => document.activeElement === el),
        true,
        "Foco inicial no título",
      );
      const loja = dialog.getByRole("combobox", { name: "Loja", exact: true });
      assert.equal(await loja.inputValue(), "Ferragens", "Nome salvo continua visível");
      assert.equal(await loja.getAttribute("aria-expanded"), "false", "Busca não abre ao editar");
      assert.equal(await page.getByRole("listbox").count(), 0);
      await loja.click();
      await page.getByRole("option", { name: "Ferragens", exact: true }).waitFor();
      assert.equal(await loja.getAttribute("aria-expanded"), "true");
      await page.getByRole("option", { name: "Ferragens", exact: true }).click();
      await titulo.click();
      await page.keyboard.press("Tab");
      assert.equal(
        await loja.evaluate((el) => document.activeElement === el),
        true,
        "Acesso por teclado preservado",
      );
      await page.keyboard.press("Escape");
      assert.equal(await loja.inputValue(), "Ferragens");
      assert.equal(await loja.getAttribute("aria-expanded"), "false");
      assert.equal(escritas, 0, "Abrir e pesquisar não salva nem altera o desconto");
      assert.deepEqual(erros, []);
      fs.mkdirSync("/tmp/edicao-desconto-foco", { recursive: true });
      await page.screenshot({ path: `/tmp/edicao-desconto-foco/${width}.png`, fullPage: true });
      console.log(`${width}px: nome salvo, busca fechada, clique e teclado OK; nenhuma gravação.`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
