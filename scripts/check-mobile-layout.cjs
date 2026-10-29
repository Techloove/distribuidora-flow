// Execute com Playwright instalado e servidor local configurado para mobile-fixture.
// Todas as requisições externas são bloqueadas ou substituídas por dados fictícios.
const { chromium } = require("playwright");
const fs = require("fs");
const baseURL = process.env.MOBILE_BASE_URL ?? "http://127.0.0.1:5174";
if (!["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname))
  throw new Error("Use somente servidor local com configuração mobile-fixture.");
const output = process.env.MOBILE_OUTPUT_DIR ?? "/tmp/caparao-mobile-layout";
fs.mkdirSync(output, { recursive: true });
const { uid, center, rows, pedido, rpcs } = require("./fixtures/mobile-layout.cjs");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: Number(process.env.MOBILE_WIDTH ?? 390), height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    ({ uid }) => {
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
      );
    },
    { uid },
  );
  const seen = new Set();
  await context.route("**/*", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (["127.0.0.1", "localhost"].includes(u.hostname)) return route.continue();
    if (u.hostname !== "mobile-fixture.supabase.co") return route.abort();
    const table = u.pathname.split("/").pop();
    seen.add(u.pathname);
    let body = rows[table] ?? [];
    if (u.pathname.includes("/rpc/"))
      body =
        table === "meus_centros"
          ? [center]
          : table === "dashboard_resumo"
            ? {
                clientes: 1,
                produtos: 1,
                pedidosAbertos: 1,
                vendasConfirmadas: 1234567.89,
                receber: 1234567.89,
                receberVencido: 500,
                pagar: 12345,
                pagarVencido: 10,
                comissoes: 1000,
                alertas: [],
              }
            : table === "dashboard_rankings"
              ? {}
              : table.startsWith("pode_")
                ? true
                : [];
    if (u.pathname.includes("/rpc/") && rpcs[table]) body = rpcs[table];
    if (u.pathname === "/auth/v1/user") body = { id: uid, email: "teste@example.invalid" };
    const accept = req.headers().accept ?? "";
    if (accept.includes("vnd.pgrst.object")) body = Array.isArray(body) ? (body[0] ?? {}) : body;
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "content-range": "0-0/0",
      },
      body: JSON.stringify(body),
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 400));
  });
  const paths = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs
        .readdirSync("src/routes/_app")
        .filter((f) => f.endsWith(".tsx") && f !== "route.tsx")
        .map((f) => f.replace(".tsx", ""));
  const results = [];
  for (const path of paths) {
    await page.goto(baseURL + "/" + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({
      url: location.pathname,
      title: document.querySelector("h1")?.textContent,
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      overflows: [...document.querySelectorAll("main *")]
        .filter((e) => {
          const r = e.getBoundingClientRect(),
            s = getComputedStyle(e);
          if (r.width === 0 || s.position === "fixed") return false;
          let p = e.parentElement;
          while (p && p.tagName !== "MAIN") {
            if (["auto", "scroll", "hidden"].includes(getComputedStyle(p).overflowX)) return false;
            p = p.parentElement;
          }
          return r.right > innerWidth + 1 || r.left < -1;
        })
        .slice(0, 15)
        .map((e) => ({
          tag: e.tagName,
          cls: e.className,
          text: e.textContent.slice(0, 70),
          width: e.getBoundingClientRect().width,
        })),
    }));
    results.push({ path, ...r });
    console.log(path + ": " + r.title + " (" + r.width + "px)");
    await page.screenshot({
      path: output + "/" + (process.env.MOBILE_WIDTH ?? 390) + "-" + path.split("?")[0] + ".png",
      fullPage: true,
    });
  }
  fs.writeFileSync(
    output + "/results-" + (process.env.MOBILE_WIDTH ?? 390) + ".json",
    JSON.stringify({ results, errors, requests: [...seen] }, null, 2),
  );
  const failed = results.filter(
    (r) =>
      r.scroll > Number(process.env.MOBILE_WIDTH ?? 390) + 1 ||
      r.width > Number(process.env.MOBILE_WIDTH ?? 390) + 1 ||
      r.overflows.length ||
      !r.title ||
      /Não foi possível/.test(r.title),
  );
  console.log(
    JSON.stringify(
      {
        pages: results.length,
        failed,
        errors: errors.filter((e) => !e.includes("net::ERR_FAILED")),
      },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(failed.length || errors.some((e) => !e.includes("net::ERR_FAILED")) ? 1 : 0);
})();
