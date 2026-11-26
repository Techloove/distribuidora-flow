import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  executarRestauracao,
  validarListaPacote,
} from "../scripts/executor-restauracao-backup.mjs";

test("importação aceita apenas arquivos cifrados regulares, sem links ou caminhos", () => {
  const names = ["./", "./manifesto.enc", "./banco.dump.enc", "./aplicacao.tar.enc"];
  const types = ["d", "-", "-", "-"];
  expect(() => validarListaPacote(names.join("\n"), types.join("\n"))).not.toThrow();
  for (const name of ["../fora.enc", "./pasta/a.enc", "./codigo.sh", "./manifesto.enc"])
    expect(() =>
      validarListaPacote([...names, name].join("\n"), [...types, "-"].join("\n")),
    ).toThrow();
  expect(() => validarListaPacote(names.join("\n"), ["d", "l", "-", "-"].join("\n"))).toThrow();
  expect(() => validarListaPacote(names.slice(1, 3).join("\n"), "-\n-")).toThrow();
});

test("fila importa cópia conferida e só conclui após comparação isolada", async () => {
  const temp = await mkdtemp(join(tmpdir(), "fixture-restore-"));
  const root = `/tmp/caparao-restore-${Date.now()}-1`;
  try {
    const files = join(temp, "origem");
    await mkdir(files);
    for (const f of ["manifesto.enc", "banco.dump.enc", "aplicacao.tar.enc"])
      await writeFile(join(files, f), "cifrado-fixture");
    const tar = join(temp, "pacote.tar");
    expect(spawnSync("tar", ["-cf", tar, "-C", files, "."]).status).toBe(0);
    const bytes = await readFile(tar);
    const job = {
      id: "11111111-1111-4111-8111-111111111111",
      lease: "22222222-2222-4222-8222-222222222222",
      objeto: "11111111-1111-4111-8111-111111111111/backup-2026-11-26T00-00-00-000Z.tar",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const calls: Record<string, unknown>[] = [];
    const stages: string[] = [];
    const env = {
      RESTORE_TEST_ROOT: root,
      EXT_SUPABASE_URL: "https://fixture.invalid",
      EXT_SUPABASE_SERVICE_ROLE_KEY: "fixture",
      GITHUB_OUTPUT: join(temp, "output"),
    };
    let corrupt = false;
    const options = {
      env,
      request: async (url: URL, init: RequestInit) => {
        if (url.pathname.includes("/storage/"))
          return new Response(corrupt ? bytes.subarray(1) : bytes);
        if (url.pathname.endsWith("assumir_restauracao_backup_378")) return Response.json(job);
        calls.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 204 });
      },
      validar: async (stage: string) => {
        stages.push(stage);
        expect(await readFile(join(root, "criptografado", "manifesto.enc"), "utf8")).toBe(
          "cifrado-fixture",
        );
        if (stage === "restaurar")
          await writeFile(
            join(root, "relatorio.json"),
            JSON.stringify({ tabelas_comparadas: 200 }),
          );
      },
    };
    await executarRestauracao("assumir", options);
    await executarRestauracao("restaurar", options);
    expect(stages).toEqual(["preparar", "restaurar"]);
    expect(calls[0]?._sucesso).toBe(true);
    await rm(join(root, "criptografado"), { recursive: true });
    corrupt = true;
    await expect(executarRestauracao("restaurar", options)).rejects.toThrow(
      "Pacote incompleto ou adulterado",
    );
    expect(calls).toHaveLength(1);
    await executarRestauracao("falhar", options);
    expect(calls[1]?._sucesso).toBe(false);
    await expect(
      executarRestauracao("assumir", {
        ...options,
        env: { ...env, RESTORE_TEST_ROOT: "/workspace" },
      }),
    ).rejects.toThrow("Destino isolado inválido");
  } finally {
    await rm(temp, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
