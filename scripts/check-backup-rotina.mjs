import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executarRotina } from "./rotina-backup.mjs";
const temp = await mkdtemp(join(tmpdir(), "caparao-backup-"));
try {
  const local = join(temp, "local"),
    externo = join(temp, "externo");
  await mkdir(externo);
  const nome = "backup-2026-10-24T03-00-00-000Z";
  let verificacoes = 0;
  const run = async (script, args) => {
    if (script === "backup-supabase.mjs") {
      await mkdir(join(args[0], nome));
      await writeFile(join(args[0], nome, "fixture.enc"), "criptografado-sintetico");
    } else {
      assert.equal(await readFile(join(args[0], "fixture.enc"), "utf8"), "criptografado-sintetico");
      verificacoes++;
    }
  };
  await executarRotina({ local, externo }, run);
  assert.equal(verificacoes, 2);
  const status = JSON.parse(await readFile(join(local, "status.json")));
  assert.equal(status.estado, "sucesso");
  assert.equal(status.copia_externa_verificada, true);
  assert.equal(
    await readFile(join(externo, nome, "fixture.enc"), "utf8"),
    "criptografado-sintetico",
  );
  await assert.rejects(executarRotina({ local, externo: local }, run), /separados/);
  await assert.rejects(executarRotina({ local, externo: join(local, "filho") }, run));
  await assert.rejects(executarRotina({ local, externo: join(temp, "ausente") }, run), /ENOENT/);
  await mkdir(join(local, ".rotina.lock"));
  await assert.rejects(executarRotina({ local, externo }, run), /bloqueio/);
  await rm(join(local, ".rotina.lock"), { recursive: true });
  const failLocal = join(temp, "falha");
  let calls = 0;
  await assert.rejects(
    executarRotina({ local: failLocal, externo }, async (script, args) => {
      if (script === "backup-supabase.mjs") {
        await mkdir(join(args[0], nome));
        await writeFile(join(args[0], nome, "fixture.enc"), "x");
      } else if (++calls === 2) throw new Error("Cópia adulterada");
    }),
    /adulterada/,
  );
  assert.equal(JSON.parse(await readFile(join(failLocal, "status.json"))).estado, "falha");
  assert.equal(
    (await readdir(externo)).some((n) => n.endsWith(".partial")),
    false,
  );
  assert.equal((await readdir(failLocal)).includes(".rotina.lock"), false);
  console.log(
    "Rotina de backup OK: cópia externa verificada, falha sem sucesso falso, destinos separados, bloqueio concorrente e limpeza de parcial.",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
