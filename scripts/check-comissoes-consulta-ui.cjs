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
      const consultas = { detalhe: 0, metas: 0, pagamentos: 0, proporcional: 0, ajustes: 0 };
      let falha = true;
      const linha = {
        comissao_id: id(600),
        pedido_id: id(601),
        pedido_numero: 42,
        representante_id: id(40),
        representante: "Vendedor teste",
        cliente_id: id(20),
        cliente: "Cliente teste",
        centro_id: center,
        centro: "Ferragens",
        base_calculo: 100,
        percentual: 5,
        valor: 5,
        status: "prevista",
        data_competencia: "2026-11-20",
        mes: "2026-11",
        pagamento_id: null,
      };
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
            { role, path: "/comissoes" },
            { role, path: "/dashboard" },
            { role, path: "/pedidos" },
          ];
        if (nome === "centros")
          body = [
            { id: center, nome: "Ferragens" },
            { id: outro, nome: "Cimento" },
          ];
        if (nome === "vw_comissoes_detalhe") {
          consultas.detalhe++;
          if (falha)
            return route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({
                code: "57014",
                message: "canceling statement due to statement timeout",
              }),
            });
          body = u.searchParams.get("centro_id") === "eq." + outro ? [] : [linha];
        }
        if (nome === "vw_comissoes_resumo" || nome === "resumo_comissoes_loja_295") {
          consultas.metas++;
          body = [];
        }
        if (nome === "comissao_pagamentos") {
          consultas.pagamentos++;
          body = [];
        }
        if (nome === "vw_comissao_proporcional_217") {
          consultas.proporcional++;
          body = [];
        }
        if (nome === "comissao_ajustes") {
          consultas.ajustes++;
          body = [];
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
      await page.goto(base + "/comissoes", { waitUntil: "domcontentloaded" });
      const main = page.getByRole("main");
      await main.getByText(/A consulta de comissões excedeu o tempo limite/).waitFor();
      assert.equal(await main.getByText(/fase45/).count(), 0);
      assert.equal(consultas.metas, 0);
      assert.equal(consultas.pagamentos, 0);
      assert.equal(consultas.proporcional, 0);
      assert.equal(consultas.ajustes, 0);
      falha = false;
      await main.getByRole("button", { name: "Tentar novamente", exact: true }).click();
      await main.getByText("42", { exact: true }).waitFor();
      const antes = consultas.detalhe;
      if (width < 640)
        await main.getByRole("button", { name: "Mostrar filtros", exact: true }).click();
      await main
        .getByLabel("Buscar (representante/cliente/pedido)", { exact: true })
        .fill("Vendedor");
      await main.getByText("42", { exact: true }).waitFor();
      assert.equal(consultas.detalhe, antes, "Busca local sem repetir consulta pesada");
      await main.getByRole("tab", { name: "Metas e atingimento" }).click();
      await main.getByText("Sem comissões apuradas.", { exact: true }).waitFor();
      assert.equal(consultas.metas, 1);
      await main.getByRole("tab", { name: "Pagamentos gerados" }).click();
      await main.getByText("Nenhum pagamento de comissão gerado.", { exact: true }).waitFor();
      assert.equal(consultas.pagamentos, 1);
      await main.getByRole("tab", { name: "Apuração por pedido" }).click();
      await page.getByRole("combobox", { name: "Loja", exact: true }).click();
      await page.getByRole("option", { name: "Cimento", exact: true }).click();
      await main.getByText("Nenhuma comissão neste filtro.", { exact: true }).waitFor();
      assert.ok(
        (await page.evaluate(() => document.documentElement.scrollWidth)) <= width + 1,
        "Sem overflow da página",
      );
      fs.mkdirSync("/tmp/comissoes-consulta-ui", { recursive: true });
      await page.screenshot({ path: `/tmp/comissoes-consulta-ui/${width}.png`, fullPage: true });
      assert.deepEqual(erros, []);
      console.log(
        `${width}px ${role}: timeout correto, abas sob demanda, busca local e loja sem comissão OK`,
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
