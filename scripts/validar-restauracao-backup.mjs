/** Ensaio descartável: não aceita endereço de banco e não conecta à produção. */
import { spawnSync } from "node:child_process";
import { mkdir, chmod, readdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

function command(program, args, input, env = process.env) {
  return spawnSync(program, args, {
    input,
    env,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout: 180_000,
  });
}
function requireOk(result, message) {
  if (result.status !== 0) throw new Error(message);
  return result.stdout;
}
const identifier = '(?:"(?:[^"\n]|"")+"|[a-z_][a-z0-9_$]*)';
const copyPattern = new RegExp(
  `^COPY (${identifier}\\.${identifier}) \\((${identifier}(?:, ${identifier})*)\\) FROM stdin;$`,
);

export function dadosCopy(sql) {
  const copies = [];
  let current = null;
  for (const line of sql.split("\n")) {
    if (current) {
      if (line === "\\.") {
        copies.push(current);
        current = null;
      } else current.rows.push(line);
    } else {
      const match = copyPattern.exec(line);
      if (match) current = { table: match[1], columns: match[2], rows: [] };
    }
  }
  if (current) throw new Error("Seção COPY truncada no dump.");
  return copies;
}
export function hashLinhas(rows) {
  const hash = createHash("sha256");
  for (const line of [...rows].sort()) hash.update(line + "\n");
  return hash.digest("hex");
}
export function nomePapelAusente(stderr) {
  return /ERROR:\s+role "([^"\n]+)" does not exist/.exec(stderr)?.[1];
}
function motivoSeguro(stderr) {
  for (const kind of ["extension", "schema", "type", "relation"]) {
    const match = new RegExp(
      `ERROR:\\s+${kind} "([a-zA-Z0-9_.-]+)" (?:does not exist|is not available)`,
    ).exec(stderr);
    if (match) return ` (${kind}: ${match[1]})`;
  }
  if (stderr.includes("can only be created in database")) return " (banco exigido pela extensão)";
  if (stderr.includes("must be loaded via shared_preload_libraries"))
    return " (pré-carregamento da extensão)";
  return "";
}

export async function validarRestauracao(etapa, env = process.env) {
  const root = resolve(env.RESTORE_TEST_ROOT ?? "");
  const container = env.RESTORE_CONTAINER ?? "";
  if (
    !/^\/tmp\/caparao-restore-[0-9]+-[0-9]+$/.test(root) ||
    !/^caparao-restore-[0-9]+-[0-9]+$/.test(container)
  )
    throw new Error("Destino de teste isolado inválido.");
  const docker = (args, input, customEnv) => command("docker", args, input, customEnv);
  const psql = (query) =>
    requireOk(
      docker(
        [
          "exec",
          "-i",
          container,
          "psql",
          "-X",
          "-q",
          "-A",
          "-t",
          "-v",
          "ON_ERROR_STOP=1",
          "-h",
          "/tmp",
          "-U",
          "postgres",
          "-d",
          "postgres",
        ],
        query,
      ),
      "Falha na consulta de conferência do banco isolado.",
    );
  if (etapa === "limpar") {
    docker(["rm", "-f", "-v", container]);
    await rm(root, { recursive: true, force: true });
    return;
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const extraido = join(root, "extraido");
  if (etapa === "preparar") {
    if (!/^[a-f0-9]{64}$/i.test(env.ERP_BACKUP_KEY ?? ""))
      throw new Error("Chave de recuperação ausente ou inválida.");
    requireOk(
      command(
        process.execPath,
        [
          new URL("verificar-backup.mjs", import.meta.url).pathname,
          join(root, "criptografado"),
          "--extrair",
          extraido,
        ],
        undefined,
        env,
      ),
      "Integridade ou descriptografia do backup recusada.",
    );
    console.log("Pacote verificado e extraído em diretório privado.");
    return;
  }
  if (etapa !== "restaurar") throw new Error("Etapa de restauração desconhecida.");
  if (env.RESTORE_IMAGE !== "supabase/postgres:17.6.1.136")
    throw new Error("Imagem de restauração não autorizada.");
  const startup =
    "set -e; initdb -D /tmp/restore-db --no-locale --encoding=UTF8 --username=postgres --auth-local=trust --auth-host=reject >/tmp/initdb.log 2>&1; exec postgres -D /tmp/restore-db -c listen_addresses='' -c unix_socket_directories=/tmp -c shared_preload_libraries=pg_stat_statements,pg_cron,pg_net,supabase_vault -c cron.database_name=postgres -c cron.launch_active_jobs=off -c pg_net.database_name=restore_disabled";
  requireOk(
    docker(
      [
        "run",
        "-d",
        "--network",
        "none",
        "--name",
        container,
        "--user",
        "postgres",
        "-e",
        "PGSODIUM_ROOT_KEY",
        "--entrypoint",
        "/bin/bash",
        env.RESTORE_IMAGE,
        "-c",
        startup,
      ],
      undefined,
      { ...env, PGSODIUM_ROOT_KEY: randomBytes(32).toString("hex") },
    ),
    "Não foi possível iniciar o banco temporário.",
  );
  const network = requireOk(
    docker([
      "inspect",
      "--format",
      "{{.HostConfig.NetworkMode}} {{len .HostConfig.PortBindings}}",
      container,
    ]),
    "Não foi possível conferir o isolamento.",
  ).trim();
  if (network !== "none 0") throw new Error("Isolamento de rede não confirmado.");
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (docker(["exec", container, "pg_isready", "-h", "/tmp", "-U", "postgres"]).status === 0) {
      ready = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  if (!ready) {
    const logs = docker(["logs", container]).stderr;
    const missing = /could not access file "([a-zA-Z0-9_.-]+)"/.exec(logs)?.[1];
    throw new Error(
      "Banco temporário não ficou pronto" + (missing ? ` (biblioteca: ${missing})` : "") + ".",
    );
  }
  requireOk(
    docker(["cp", join(extraido, "banco.dump"), container + ":/tmp/banco.dump"]),
    "Falha ao copiar o dump para o banco isolado.",
  );
  requireOk(
    docker(["exec", "--user", "root", container, "chown", "postgres:postgres", "/tmp/banco.dump"]),
    "Falha na permissão do dump temporário.",
  );
  let placeholders = 0;
  for (const section of ["pre-data", "data", "post-data"]) {
    let complete = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const args = [
        "exec",
        container,
        "pg_restore",
        "--exit-on-error",
        "--single-transaction",
        "--section=" + section,
        "-h",
        "/tmp",
        "-U",
        "postgres",
        "-d",
        "postgres",
        ...(section === "data" ? ["--disable-triggers"] : []),
        "/tmp/banco.dump",
      ];
      const result = docker(args);
      if (result.status === 0) {
        complete = true;
        break;
      }
      const role = nomePapelAusente(result.stderr);
      if (!role)
        throw new Error(
          "Restauração recusada em " +
            section +
            motivoSeguro(result.stderr) +
            ". Dados não são exibidos nos logs.",
        );
      // Somente nomes/ACL do dump: não cria logins nem recupera senhas de papéis globais.
      psql(
        'CREATE ROLE "' +
          role.replace(/"/g, '""') +
          '" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;',
      );
      placeholders++;
    }
    if (!complete) throw new Error("Limite de preparação dos papéis do destino excedido.");
    console.log("Etapa " + section + " restaurada.");
  }
  const dataSql = requireOk(
    docker(["exec", container, "pg_restore", "--data-only", "--file=-", "/tmp/banco.dump"]),
    "Falha ao ler o conteúdo esperado do dump.",
  );
  const copies = dadosCopy(dataSql);
  if (!copies.length) throw new Error("Nenhuma tabela de dados foi conferida.");
  let rows = 0;
  for (const copy of copies) {
    const actual = psql(
      "SET TIME ZONE 'UTC'; SET extra_float_digits=3; SET DateStyle='ISO'; SET IntervalStyle='postgres'; COPY " +
        copy.table +
        " (" +
        copy.columns +
        ") TO stdout;",
    );
    const actualRows = actual.replace(/\n$/, "").split("\n");
    // psql não deve imprimir comandos SET em modo silencioso; filtragem não é usada para esconder falhas.
    if (actualRows.length === 1 && actualRows[0] === "") actualRows.pop();
    if (copy.rows.length !== actualRows.length || hashLinhas(copy.rows) !== hashLinhas(actualRows))
      throw new Error("Conteúdo restaurado diverge do dump; nenhum dado é exibido no relatório.");
    rows += copy.rows.length;
  }
  const invalid = Number(psql("select count(*) from pg_index where not indisvalid;").trim());
  if (invalid !== 0) throw new Error("Índices inválidos após a restauração.");
  const sourceFiles = requireOk(
    command("tar", ["-tf", join(extraido, "aplicacao.tar")]),
    "Código versionado não recuperado.",
  )
    .split("\n")
    .filter((name) => name && !name.endsWith("/"));
  const packageInfo = JSON.parse(
    requireOk(
      command("tar", ["-xOf", join(extraido, "aplicacao.tar"), "package.json"]),
      "Versão do código não recuperada.",
    ),
  );
  let storageObjects = 0;
  const walk = async (path) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(path, entry.name));
      else if (entry.isFile()) storageObjects++;
    }
  };
  try {
    await walk(join(extraido, "storage"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const report = {
    resultado: "restauracao_logica_verificada",
    execucao_backup: env.RESTORE_SOURCE_RUN,
    data_utc: new Date().toISOString(),
    imagem: env.RESTORE_IMAGE,
    isolamento_rede: network,
    tabelas_comparadas: copies.length,
    registros_comparados: rows,
    comparacao: "quantidade_e_sha256_das_linhas_COPY",
    indices_invalidos: invalid,
    papeis_sem_login_preparados: placeholders,
    arquivos_codigo: sourceFiles.length,
    versao_codigo: packageInfo.version,
    objetos_storage_extraidos: storageObjects,
    limites: [
      "Não valida login pela API Auth ou serviços externos",
      "Papéis globais são placeholders sem login; infraestrutura precisa ser preparada no destino",
      "Chaves raiz do provedor e descriptografia do Vault exigem recuperação separada",
    ],
  };
  await writeFile(join(root, "relatorio.json"), JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  validarRestauracao(process.argv[2]).catch((error) => {
    console.error(
      "::error::" +
        String(error.message).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A"),
    );
    process.exitCode = 1;
  });
}
