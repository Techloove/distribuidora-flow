import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const root = new URL("../", import.meta.url),
  temp = await mkdtemp(join(tmpdir(), "caparao-versao-"));
try {
  for (const dir of ["scripts", "src/content", "docs"])
    await mkdir(join(temp, dir), { recursive: true });
  for (const file of [
    "package.json",
    "src/content/versoes.json",
    "src/content/manual.json",
    "docs/manual-do-usuario.md",
    "scripts/versionar.mjs",
    "scripts/check-version.mjs",
    "scripts/gerar-manual.mjs",
    "scripts/gerar-versao-publica.mjs",
  ])
    await cp(new URL(file, root), join(temp, file));
  const baseEnv = { ...process.env };
  delete baseEnv.VERCEL;
  delete baseEnv.NITRO_PRESET;
  const run = (script, args = [], env = {}) =>
    spawnSync(process.execPath, [join(temp, "scripts", script), ...args], {
      encoding: "utf8",
      env: { ...baseEnv, ...env },
    });
  const manifest = async () => JSON.parse(await readFile(join(temp, "package.json"), "utf8"));
  const inicial = await manifest();
  let [major, minor, patch] = inicial.version.split(".").map(Number);
  for (const tipo of ["patch", "minor", "major"]) {
    if (tipo === "major") {
      major++;
      minor = 0;
      patch = 0;
    } else if (tipo === "minor") {
      minor++;
      patch = 0;
    } else patch++;
    const r = run("versionar.mjs", [tipo, "Atualização sintética " + tipo]);
    assert.equal(r.status, 0, r.stderr);
    const esperado = [major, minor, patch].join(".");
    assert.equal((await manifest()).version, esperado);
    assert.equal(run("check-version.mjs").status, 0);
    const historico = JSON.parse(await readFile(join(temp, "src/content/versoes.json"), "utf8"));
    assert.equal(historico[0].versao, esperado);
    assert.match(historico[0].data, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(
      historico.at(-1).versao,
      JSON.parse(await readFile(new URL("src/content/versoes.json", root), "utf8")).at(-1).versao,
    );
  }
  assert.equal(run("gerar-versao-publica.mjs").status, 0);
  const publico = JSON.parse(await readFile(join(temp, "public/versao.json"), "utf8"));
  assert.equal(publico.versao, (await manifest()).version);
  assert.deepEqual(Object.keys(publico).sort(), ["data", "titulo", "versao"]);
  // Build limpo da Vercel: não há dist/client nem .output/public.
  const finalizar = () => run("gerar-versao-publica.mjs", ["--finalizar"], { VERCEL: "1" });
  assert.notEqual(finalizar().status, 0);
  await mkdir(join(temp, ".vercel/output/static"), { recursive: true });
  await cp(join(temp, "public/versao.json"), join(temp, ".vercel/output/static/versao.json"));
  const routes = [
    { src: "/assets/(.*)", headers: { "cache-control": "public, max-age=31536000, immutable" } },
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/__server" },
  ];
  await writeFile(join(temp, ".vercel/output/config.json"), JSON.stringify({ version: 3, routes }));
  assert.equal(finalizar().status, 0);
  const configPath = join(temp, ".vercel/output/config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(config.routes.slice(1), routes);
  assert.equal(config.routes[0].src, "^/versao\\.json$");
  assert.equal(config.routes[0].continue, true);
  for (const header of ["Cache-Control", "CDN-Cache-Control", "Vercel-CDN-Cache-Control"])
    assert.match(config.routes[0].headers[header], /no-store/);
  assert.equal(finalizar().status, 0);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), config);
  await writeFile(
    join(temp, ".vercel/output/static/versao.json"),
    JSON.stringify({ ...publico, versao: "0.0.0" }),
  );
  assert.notEqual(finalizar().status, 0);
  await mkdir(join(temp, ".output/public"), { recursive: true });
  await cp(join(temp, "public/versao.json"), join(temp, ".output/public/versao.json"));
  // Uma cópia válida de outro destino não pode esconder um build Vercel divergente.
  assert.notEqual(finalizar().status, 0);
  await rm(join(temp, ".vercel/output/static/versao.json"));
  assert.notEqual(finalizar().status, 0);
  await writeFile(
    join(temp, ".output/public/_headers"),
    "/assets/*\n  cache-control: public, max-age=31536000, immutable\n",
  );
  assert.equal(run("gerar-versao-publica.mjs", ["--finalizar"]).status, 0);
  assert.equal(run("gerar-versao-publica.mjs", ["--finalizar"]).status, 0);
  const headers = await readFile(join(temp, ".output/public/_headers"), "utf8");
  assert.match(headers, /max-age=31536000/);
  assert.match(headers, /Cache-Control: no-store, no-cache, must-revalidate/);
  assert.equal(headers.split("/versao.json").length, 2);
  await writeFile(
    join(temp, ".output/public/versao.json"),
    JSON.stringify({ ...publico, versao: "0.0.0" }),
  );
  assert.notEqual(run("gerar-versao-publica.mjs", ["--finalizar"]).status, 0);
  const antes = await readFile(join(temp, "package.json"), "utf8");
  assert.notEqual(run("versionar.mjs", ["patch"]).status, 0);
  assert.equal(await readFile(join(temp, "package.json"), "utf8"), antes);
  await writeFile(join(temp, "docs/manual-do-usuario.md"), "manual antigo");
  assert.notEqual(run("check-version.mjs").status, 0);
  assert.equal(run("gerar-manual.mjs").status, 0);
  assert.equal(run("check-version.mjs").status, 0);
  const dados = await manifest();
  dados.version = "999.0.0";
  await writeFile(join(temp, "package.json"), JSON.stringify(dados));
  assert.notEqual(run("check-version.mjs").status, 0);
  assert.equal(
    JSON.parse(await readFile(new URL("package.json", root), "utf8")).version,
    inicial.version,
  );
  console.log(
    "Versionamento OK: patch/minor/major, histórico preservado, manual sincronizado, rejeição de resumo vazio e de versões divergentes; testes em diretório temporário.",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
