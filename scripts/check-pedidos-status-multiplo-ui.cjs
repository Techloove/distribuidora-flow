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
      let escritas = 0;
      const pedidos = [
        ["confirmado", 100],
        ["entregue", 200],
        ["cancelado", 300],
        ["rascunho", 400],
      ].map(([status, valor], i) => ({
        ...rows.pedidos[0],
        id: id(800 + i),
        numero: 800 + i,
        status,
        tipo_documento: "pedido",
        data_pedido: "2026-11-24",
        centro_id: center,
        representante_id: id(40),
        total_itens: valor,
        total_liquido: valor,
      }));
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
        if (nome === "user_roles") body = [{ role }];
        if (nome === "role_menus")
          body = [
            { role, path: "/pedidos" },
            { role, path: "/dashboard" },
          ];
        if (nome === "pedidos") {
          body = pedidos;
          if (req.method() !== "GET") escritas++;
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
      await page.goto(base + "/pedidos", { waitUntil: "domcontentloaded" });
      const main = page.getByRole("main");
      await main.getByText("#800", { exact: true }).waitFor();
      if (width < 640)
        await main.getByRole("button", { name: "Mostrar filtros", exact: true }).click();
      await main.getByRole("button", { name: "Status", exact: true }).click();
      const grupo = page.getByRole("group", { name: "Situações do pedido" });
      await grupo.getByRole("checkbox", { name: "Aprovado", exact: true }).check();
      await grupo.getByRole("checkbox", { name: "Entregue", exact: true }).check();
      await page.waitForFunction(() => document.querySelectorAll("main tbody tr").length === 2);
      assert.ok(
        (
          await main.getByText("Total dos documentos", { exact: true }).locator("..").innerText()
        ).includes("300,00"),
      );
      await page.keyboard.press("Escape");
      await main.getByRole("button", { name: "Entregue (1)", exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll("main tbody tr").length === 1);
      await main.getByRole("button", { name: "Cancelado (1)", exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll("main tbody tr").length === 2);
      assert.ok(
        (
          await main.getByText("Total dos documentos", { exact: true }).locator("..").innerText()
        ).includes("400,00"),
      );
      await main.getByRole("button", { name: "Todos (4)", exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll("main tbody tr").length === 4);
      assert.ok(
        (
          await main.getByText("Total dos documentos", { exact: true }).locator("..").innerText()
        ).includes("1.000,00"),
      );
      assert.equal(escritas, 0);
      assert.deepEqual(erros, []);
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width + 1);
      fs.mkdirSync("/tmp/pedidos-status-multiplo", { recursive: true });
      await page.screenshot({ path: `/tmp/pedidos-status-multiplo/${width}.png`, fullPage: true });
      console.log(
        `${width}px ${role}: múltiplos status, etiquetas combinadas, totais e limpeza OK`,
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
