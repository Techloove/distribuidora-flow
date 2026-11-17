// Somente servidor local e respostas fictícias; nenhuma gravação bancária ou financeira real.
const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { uid, center, rows, rpcs, id } = require("./fixtures/mobile-layout.cjs");
const base = process.env.MOBILE_BASE_URL ?? "http://127.0.0.1:5174";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Use somente servidor local.");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    for (const [width, receber] of [
      [1366, true],
      [390, true],
      [768, false],
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
      const tabela = receber ? "vw_titulos_receber" : "vw_titulos_pagar",
        parceiro = receber
          ? rows.clientes[0]
          : (rows.fornecedores?.[0] ?? { ...rows.clientes[0], id: id(21), codigo: "FORN-01" });
      let titulos = [],
        calls = [],
        respostaIncorreta = false;
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
        if (nome === "categorias_financeiras")
          body = [
            {
              id: id(701),
              nome: "Categoria de teste",
              tipo: receber ? "receita" : "despesa",
              parent_id: null,
              ativo: true,
              ordem: 0,
            },
          ];
        if (nome === "fornecedores" && !receber) body = [parceiro];
        if (nome === tabela || nome === (receber ? "contas_receber" : "contas_pagar"))
          body = titulos;
        if (nome === "criar_receita" || nome === "criar_despesa") {
          const dados = JSON.parse(req.postData());
          calls.push(dados);
          await new Promise((r) => setTimeout(r, 200));
          body = respostaIncorreta ? 3 : dados._parcelas;
          if (!respostaIncorreta)
            titulos = Array.from({ length: dados._parcelas }, (_, i) => ({
              id: id(800 + i),
              documento: dados._documento,
              parcela: i + 1,
              valor: dados._valor / dados._parcelas,
              valor_pago: 0,
              saldo: dados._valor / dados._parcelas,
              status: "aberto",
              centro_id: center,
              [receber ? "cliente_id" : "fornecedor_id"]: parceiro.id,
              vencimento: ["2026-11-18", "2026-11-25", "2026-12-02", "2026-12-09"][i],
              data_emissao: "2026-11-17",
            }));
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
      const page = await context.newPage();
      const erros = [];
      page.on("pageerror", (e) => erros.push(e.message));
      await page.goto(base + (receber ? "/receber" : "/pagar"), { waitUntil: "domcontentloaded" });
      const preencher = async (documento) => {
        await page
          .getByRole("button", {
            name: receber ? "Nova conta a receber" : "Nova conta a pagar",
            exact: true,
          })
          .click();
        const dlg = page.getByRole("dialog");
        await dlg.waitFor();
        const escolher = async (idInput, nome) => {
          await dlg.locator("#" + idInput).click();
          await page.getByRole("option", { name: nome, exact: true }).click();
        };
        await escolher("titulo-loja", rows.centros[0].nome);
        await escolher(
          "titulo-parceiro",
          `${parceiro.codigo ? `${parceiro.codigo} · ` : ""}${parceiro.razao_social}`,
        );
        await dlg.locator("#titulo-documento").fill(documento);
        await dlg.locator("#titulo-valor").fill("5000,00");
        await dlg.locator("#titulo-vencimento").fill("2026-11-18");
        await escolher("titulo-categoria", "Categoria de teste");
        await dlg.locator("summary").filter({ hasText: "Parcelamento" }).click();
        await dlg.getByLabel("Dividir em parcelas").check();
        await dlg.locator("#titulo-parcelas").fill("4");
        await dlg.locator("#titulo-intervalo").fill("7");
        return dlg;
      };
      const dlg = await preencher("SN10");
      const previa = dlg.getByRole("region", { name: "Prévia das parcelas" });
      assert.equal(await previa.locator("li").count(), 4);
      const textos = await previa.locator("li").allTextContents();
      for (const [i, data] of ["18/11/2026", "25/11/2026", "02/12/2026", "09/12/2026"].entries()) {
        assert(textos[i].includes(`SN10/${i + 1}`));
        assert(textos[i].includes(data));
        assert(textos[i].includes("1.250,00"));
      }
      await previa.scrollIntoViewIfNeeded();
      const dimensoes = await dlg.evaluate((e) => ({
        largura: e.clientWidth,
        conteudo: e.scrollWidth,
      }));
      assert(dimensoes.conteudo <= dimensoes.largura + 1);
      fs.mkdirSync("/tmp/previa-parcelamento", { recursive: true });
      await page.screenshot({ path: `/tmp/previa-parcelamento/${width}.png`, fullPage: false });
      await dlg.locator("form").evaluate((f) => {
        f.requestSubmit();
        f.requestSubmit();
      });
      await dlg.waitFor({ state: "hidden" });
      assert.equal(calls.length, 1);
      assert.equal(calls[0]._documento, "SN10");
      assert.equal(calls[0]._parcelas, 4);
      assert.equal(calls[0]._valor, 5000);
      assert.equal(calls[0]._intervalo_dias, 7);
      assert.equal(calls[0]._primeiro_vencimento, "2026-11-18");
      assert.equal(calls[0]._centro_id, center);
      await page.locator('td[data-label="Documento"]').filter({ hasText: "SN10/4" }).waitFor();
      assert.deepEqual(
        (await page.locator('td[data-label="Documento"]').allTextContents())
          .map((s) => s.trim())
          .sort(),
        ["SN10/1", "SN10/2", "SN10/3", "SN10/4"],
      );
      if (width === 1366) {
        respostaIncorreta = true;
        const novo = await preencher("SN11");
        await novo.getByRole("button", { name: "Lançar conta a receber", exact: true }).click();
        await novo.getByText(/O servidor não confirmou a quantidade/).waitFor();
        assert(await novo.isVisible());
        assert.equal(calls.length, 2);
      }
      assert.deepEqual(erros, []);
      await context.close();
      console.log(
        `Prévia e envio ${receber ? "receber" : "pagar"} OK em ${width}px: datas, documentos, valores, envio único e confirmação.`,
      );
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
