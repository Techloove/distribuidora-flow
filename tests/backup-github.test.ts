import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executarEtapa } from "../scripts/executor-backup-github.mjs";
import { configurarBackupGithub } from "../scripts/configurar-backup-github.mjs";

test("preparação manual guarda os segredos no cofre e não tenta configurar o GitHub", async () => {
  let guardou = false;
  const result = await configurarBackupGithub({
    somenteSupabase: true,
    env: { SUPABASE_ACCESS_TOKEN: "fixture-pat" },
    gh: async () => {
      throw new Error("GitHub não deve ser chamado");
    },
    request: async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/api-keys"))
        return Response.json([{ name: "service_role", api_key: "fixture-service" }]);
      if (path.endsWith("/pooler"))
        return Response.json([{ db_host: "fixture.pooler.supabase.com" }]);
      const q = JSON.parse(String(init.body)).query;
      if (q.startsWith("select name"))
        return Response.json([
          { name: "caparao_backup_recovery_key", decrypted_secret: "a".repeat(64) },
          { name: "caparao_backup_pgpassword", decrypted_secret: "fixture-password" },
        ]);
      if (q.includes("caparao_backup_service_role")) guardou = true;
      return Response.json([]);
    },
  });
  expect(guardou).toBe(true);
  expect(result.cofre_configurado).toBe(true);
  expect(result.segredos).toHaveLength(3);
  expect(JSON.stringify(result)).not.toContain("fixture-service");
  expect(JSON.stringify(result)).not.toContain("fixture-password");
});

const id = "11111111-1111-4111-8111-111111111111";
const lease = "22222222-2222-4222-8222-222222222222";
const backup = "backup-2026-10-28T06-00-00-000Z";

test("executor GitHub só anuncia sucesso depois de recuperar e conferir o artefato externo", async () => {
  const root = await mkdtemp(join(tmpdir(), "backup-github-"));
  try {
    const calls: { nome: string; args: Record<string, unknown> }[] = [];
    const env = {
      BACKUP_RUN_ROOT: root,
      EXT_SUPABASE_URL: "https://fixture.test",
      EXT_SUPABASE_SERVICE_ROLE_KEY: "fixture",
      PGHOST: "fixture",
      PGUSER: "reader",
      PGPASSWORD: "fixture",
      ERP_BACKUP_KEY: "a".repeat(64),
    };
    const options = {
      env,
      request: async (url: URL, init: RequestInit) => {
        calls.push({ nome: url.pathname.split("/").at(-1)!, args: JSON.parse(String(init.body)) });
        return url.pathname.endsWith("assumir_backup_268")
          ? Response.json({ id, lease })
          : new Response(null, { status: 204 });
      },
      run: async (name: string, args: string[]) => {
        if (name === "backup-supabase.mjs") {
          await mkdir(join(args[0]!, backup), { recursive: true });
          await writeFile(join(args[0]!, backup, "fixture.enc"), "conteudo-cifrado");
        } else
          expect(await readFile(join(args[0]!, "fixture.enc"), "utf8")).toBe("conteudo-cifrado");
      },
      publicar: async () => ({
        objeto: id + "/" + backup + ".tar",
        sha256: "b".repeat(64),
        bytes: 123,
      }),
    };
    await executarEtapa("assumir", options);
    await executarEtapa("gerar", options);
    await expect(executarEtapa("concluir", options)).rejects.toThrow();
    expect(calls.some((c) => c.nome === "finalizar_backup_268")).toBe(false);
    await mkdir(join(root, "externo", backup), { recursive: true });
    await writeFile(join(root, "externo", backup, "fixture.enc"), "conteudo-cifrado");
    await executarEtapa("concluir", options);
    expect(calls.at(-2)?.nome).toBe("registrar_download_backup_283");
    expect(calls.at(-1)?.args._sucesso).toBe(true);
    expect(calls.at(-1)?.args._arquivo).toBe(backup);
    await executarEtapa("falhar", options);
    expect(calls.at(-1)?.args._sucesso).toBe(false);
    expect(calls.at(-1)?.args._arquivo).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fila vazia não gera cópia e configuração ausente não reserva trabalho", async () => {
  let requests = 0;
  const options = {
    env: {
      EXT_SUPABASE_URL: "https://fixture.test",
      EXT_SUPABASE_SERVICE_ROLE_KEY: "fixture",
      PGHOST: "fixture",
      PGUSER: "reader",
      PGPASSWORD: "fixture",
      ERP_BACKUP_KEY: "a".repeat(64),
    },
    request: async () => {
      requests++;
      return Response.json(null);
    },
  };
  await executarEtapa("assumir", options);
  expect(requests).toBe(1);
  await expect(
    executarEtapa("assumir", { ...options, env: { ...options.env, PGPASSWORD: "" } }),
  ).rejects.toThrow("PGPASSWORD");
  expect(requests).toBe(1);
});

test("provisionamento usa cofre e envia segredos por stdin, sem segredo em argumentos", async () => {
  const commands: { args: string[]; input?: string }[] = [];
  const result = await configurarBackupGithub({
    env: { SUPABASE_ACCESS_TOKEN: "fixture-pat" },
    gh: async (args: string[], input?: string) => {
      commands.push({ args, input });
      return "{}";
    },
    request: async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/database/query")) {
        const q = JSON.parse(String(init.body)).query;
        if (q.startsWith("select name"))
          return Response.json([
            { name: "caparao_backup_recovery_key", decrypted_secret: "a".repeat(64) },
            { name: "caparao_backup_pgpassword", decrypted_secret: "fixture-password" },
          ]);
        expect(q).toContain("grant pg_read_all_data");
        expect(q).toContain("default_transaction_read_only=on");
        expect(q).not.toContain("fixture-password");
        return Response.json([]);
      }
      if (path.endsWith("/api-keys"))
        return Response.json([{ name: "service_role", api_key: "fixture-service-key" }]);
      return Response.json([{ db_host: "fixture.pooler.supabase.com" }]);
    },
  });
  expect(commands[0]?.args.at(-1)).toContain("/public-key");
  expect(commands.filter((c) => c.args[0] === "secret")).toHaveLength(3);
  expect(JSON.stringify(commands.map((c) => c.args))).not.toContain("fixture-password");
  expect(JSON.stringify(commands.map((c) => c.args))).not.toContain("fixture-service-key");
  expect(JSON.stringify(result)).not.toContain("a".repeat(64));
});
