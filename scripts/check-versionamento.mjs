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
  ])
    await cp(new URL(file, root), join(temp, file));
  const run = (script, args = []) =>
    spawnSync(process.execPath, [join(temp, "scripts", script), ...args], { encoding: "utf8" });
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
