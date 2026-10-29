// Teste local com Playwright: sessão, banco e PDFs fictícios; nenhum comando bancário real.
const { chromium } = require("playwright");
const { PDFDocument } = require("pdf-lib");
const { rows, uid, center, rpcs } = require("./fixtures/mobile-layout.cjs");
const assert = require("node:assert/strict");
const id = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const base = process.env.MOBILE_BASE_URL ?? "http://127.0.0.1:5174";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname))
  throw new Error("Execute somente contra um servidor local mobile-fixture.");
const output = process.env.MOBILE_OUTPUT_DIR ?? "/tmp/caparao-colunas-boletos";
require("node:fs").mkdirSync(output, { recursive: true });
const original = rows.boletos[0];
Object.assign(original, {
  linha_digitavel: "748" + "1".repeat(44),
  created_at: "2026-10-01T00:00:00Z",
});
rows.boletos = [
  original,
  { ...original, id: id(91), conta_receber_id: id(81), parcela: 2, nosso_numero: "600000124" },
  {
    ...original,
    id: id(92),
    pedido_id: id(61),
    conta_receber_id: id(82),
    documento: "PED-2",
    nosso_numero: "600000125",
  },
  {
    ...original,
    id: id(93),
    cliente_id: id(21),
    pedido_id: id(62),
    conta_receber_id: id(83),
    nosso_numero: "999999999",
  },
];
rows.contas_receber = [
  { ...rows.vw_titulos_receber[0] },
  { ...rows.vw_titulos_receber[0], id: id(84), documento: "SEM-BOLETO" },
];
rows.vw_titulos_receber = rows.contas_receber.map((v) => ({ ...v }));
rows.produtos[0].marca = "Marca Campeão de Materiais";
const preferences = new Map();
const serverCalls = [];
(async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  const base64 = await pdf.saveAsBase64();
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  async function create(userId = uid, width = 1366) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(
      ({ userId }) =>
        localStorage.setItem(
          "sb-mobile-fixture-auth-token",
          JSON.stringify({
            access_token: "fixture-token",
            refresh_token: "fixture-refresh",
            expires_at: Math.floor(Date.now() / 1000) + 7200,
            expires_in: 7200,
            token_type: "bearer",
            user: {
              id: userId,
              email: "teste@example.invalid",
              aud: "authenticated",
              role: "authenticated",
              app_metadata: {},
              user_metadata: {},
              created_at: "2026-01-01T00:00:00Z",
            },
          }),
        ),
      { userId },
    );
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      if (["127.0.0.1", "localhost"].includes(u.hostname)) {
        if (req.method() === "POST" && u.pathname.includes("_server")) {
          serverCalls.push({ url: u.pathname, data: req.postData() });
          return route.fulfill({ json: { result: { base64 }, context: {} } });
        }
        return route.continue();
      }
      if (u.hostname !== "mobile-fixture.supabase.co") return route.abort();
      const table = u.pathname.split("/").pop();
      let body = rows[table] ?? [];
      if (table === "profiles") body = rows.profiles.map((v) => ({ ...v, id: userId }));
      if (u.pathname.includes("/rpc/"))
        body =
          table === "meus_centros"
            ? [center]
            : Object.hasOwn(rpcs, table)
              ? rpcs[table]
              : table.startsWith("pode_")
                ? true
                : [];
      if (u.pathname === "/auth/v1/user") body = { id: userId, email: "teste@example.invalid" };
      if (table === "preferencias_colunas") {
        if (req.method() === "POST") {
          const v = JSON.parse(req.postData());
          preferences.set(v.usuario_id + "|" + v.tela, v);
          body = v;
        } else body = [...preferences.values()];
      }
      if (Array.isArray(body) && !u.pathname.includes("/rpc/")) {
        body = body.filter((r) =>
          [...u.searchParams].every(
            ([k, v]) => !v.startsWith("eq.") || !(k in r) || String(r[k]) === v.slice(3),
          ),
        );
        if (u.searchParams.has("limit")) body = body.slice(0, Number(u.searchParams.get("limit")));
      }
      if ((req.headers().accept ?? "").includes("vnd.pgrst.object"))
        body = Array.isArray(body) ? (body[0] ?? null) : body;
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "content-range": "0-0/1",
        },
        body: JSON.stringify(body),
      });
    });
    return { context, page: await context.newPage() };
  }
  let { context, page } = await create();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/produtos", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Colunas", exact: true }).click();
  await page.getByRole("checkbox", { name: "Marca", exact: true }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('td[data-label="Marca"]').isVisible(), false);
  assert.equal(preferences.size, 1);
  await page.screenshot({ path: `${output}/produtos-colunas.png` });
  const another = await create();
  await another.page.goto(base + "/produtos", { waitUntil: "networkidle" });
  await another.page.waitForTimeout(300);
  assert.equal(await another.page.locator('td[data-label="Marca"]').isVisible(), false);
  await another.context.close();
  const otherUser = await create(id(2));
  await otherUser.page.goto(base + "/produtos", { waitUntil: "networkidle" });
  await otherUser.page.waitForTimeout(300);
  assert.equal(await otherUser.page.locator('td[data-label="Marca"]').isVisible(), true);
  await otherUser.context.close();
  await page.goto(base + "/receber", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Colunas", exact: true }).click();
  await page.getByRole("checkbox", { name: "Pago", exact: true }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.locator('td[data-label="Pago"]').first().waitFor({ state: "hidden" });
  const sameFinance = await create();
  await sameFinance.page.goto(base + "/receber", { waitUntil: "networkidle" });
  await sameFinance.page.waitForTimeout(300);
  await sameFinance.page.locator('td[data-label="Pago"]').first().waitFor({ state: "hidden" });
  await sameFinance.context.close();
  await page.getByRole("button", { name: "Opções", exact: true }).first().click();
  await page.getByRole("button", { name: "Reimprimir boleto", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Agrupar boletos para impressão").selectOption("cliente");
  await dialog.getByText("Selecionar todos do mesmo cliente (3)", { exact: false }).waitFor();
  await dialog.getByRole("checkbox", { name: "Selecionar todos do mesmo cliente (3)" }).check();
  assert.equal(
    await dialog.getByRole("button", { name: "Abrir PDF selecionados (3)" }).isEnabled(),
    true,
  );
  assert.equal(await dialog.getByText(/999999999/).count(), 0);
  await dialog.getByLabel("Agrupar boletos para impressão").selectOption("pedido");
  await dialog.getByRole("checkbox", { name: "Selecionar todos do mesmo pedido (2)" }).check();
  await dialog.getByRole("button", { name: "Abrir PDF selecionados (2)" }).click();
  await page.waitForTimeout(1200);
  assert.equal(serverCalls.length, 2);
  assert(serverCalls.every((v) => v.data.includes("boletoId") && !v.data.includes("contaId")));
  await dialog.getByRole("link", { name: "Baixar PDF", exact: true }).waitFor();
  const url = await dialog
    .getByRole("link", { name: "Baixar PDF", exact: true })
    .getAttribute("href");
  const merged = await page.evaluate(
    async (url) => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),
    url,
  );
  assert.equal((await PDFDocument.load(new Uint8Array(merged))).getPageCount(), 2);
  await page.screenshot({ path: `${output}/boletos-lote.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Opções", exact: true }).nth(1).click();
  await page.getByRole("button", { name: "Emitir boleto", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Emitir pendentes", exact: true })
    .waitFor();
  assert.equal(serverCalls.length, 2);
  await page.keyboard.press("Escape");
  await page.goto(base + "/boletos", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Reimprimir boleto", exact: true }).first().click();
  await page
    .getByRole("dialog")
    .getByLabel("Agrupar boletos para impressão")
    .selectOption("cliente");
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: "Selecionar todos do mesmo cliente (3)" })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.goto(base + "/separacao", { waitUntil: "networkidle" });
  const clientStyle = await page
    .locator('td[data-label="Cliente"]')
    .first()
    .evaluate((el) => ({
      whiteSpace: getComputedStyle(el).whiteSpace,
      overflow: getComputedStyle(el).overflow,
      minWidth: parseFloat(getComputedStyle(el).minWidth),
    }));
  assert.equal(clientStyle.whiteSpace, "normal");
  assert.equal(clientStyle.overflow, "visible");
  assert(clientStyle.minWidth >= 200);
  await page.screenshot({ path: `${output}/separacao.png` });
  await context.close();
  const mobile = await create(uid, 390);
  await mobile.page.goto(base + "/produtos", { waitUntil: "networkidle" });
  const sizes = await mobile.page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(sizes.scroll <= sizes.width + 1);
  await mobile.page.goto(base + "/receber", { waitUntil: "networkidle" });
  await mobile.page.waitForTimeout(300);
  assert.equal(await mobile.page.locator('td[data-label="Pago"]').first().isVisible(), false);
  await mobile.page.getByRole("button", { name: "Opções", exact: true }).first().click();
  await mobile.page.getByRole("button", { name: "Reimprimir boleto", exact: true }).first().click();
  await mobile.page
    .getByRole("dialog")
    .getByLabel("Agrupar boletos para impressão")
    .selectOption("pedido");
  await mobile.page
    .getByRole("dialog")
    .getByRole("checkbox", { name: "Selecionar todos do mesmo pedido (2)" })
    .waitFor();
  const mobileWidths = await mobile.page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(mobileWidths.scroll <= mobileWidths.width + 1);
  await mobile.context.close();
  assert.equal(errors.length, 0, errors.join("\n"));
  await browser.close();
  console.log(
    "OK: preferências entre computadores e usuários; grupos cliente/pedido; produtos no celular.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
