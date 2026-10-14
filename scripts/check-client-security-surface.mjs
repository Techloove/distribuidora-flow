import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const srcDir = "src";
const dbDir = "db";

const protectedTables = new Set([
  "pedidos",
  "pedido_itens",
  "compras",
  "compra_itens",
  "estoque_movimentos",
  "estoque_saldos",
  "transferencias_estoque",
  "transferencias_estoque_itens",
  "contas_receber",
  "contas_pagar",
  "comissoes",
  "movimentos_financeiros",
  "transferencias",
  "boletos",
  "creditos_clientes",
  "creditos_clientes_aplicacoes",
  "expedicoes",
  "pedido_separacoes",
  "cargas",
  "carga_pedidos",
  "estornos_financeiros",
  "auditoria",
  "pedido_operacoes",
  "devolucao_operacoes",
  "comissao_pagamentos",
  "comissao_pagamento_itens",
  "sicredi_config",
  "sicredi_cnab_config",
  "sicredi_cnab_arquivos",
  "sicredi_cnab_eventos",
  "sicredi_boleto_alteracoes",
  "user_roles",
  "notas_saida",
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const sourceFiles = walk(srcDir).filter((p) => [".ts", ".tsx"].includes(extname(p)));
const sqlFiles = readdirSync(dbDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const sqlByFile = new Map(sqlFiles.map((name) => [name, readFileSync(join(dbDir, name), "utf8")]));

const errors = [];
const rpcNames = new Set();
const forbiddenClientTables = new Set(["sicredi_config"]);

for (const file of sourceFiles) {
  const source = readFileSync(file, "utf8");
  const display = relative(".", file);

  for (const match of source.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)) {
    rpcNames.add(match[1]);
  }

  const serverOnlyModule =
    display.endsWith(".functions.ts") ||
    display.endsWith(".functions.tsx") ||
    display.includes("/server-") ||
    display.includes("\\server-");

  if (/EXT_SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY/.test(source) && !serverOnlyModule) {
    errors.push(`${display}: chave service_role referenciada fora de módulo server-only`);
  }

  if (/VITE_[A-Z0-9_]*SERVICE_ROLE/.test(source)) {
    errors.push(
      `${display}: variável VITE_* de service_role nunca pode ser exposta ao bundle do navegador`,
    );
  }

  // Fase221 autoriza somente o primeiro cadastro pendente na rota de login.
  // Qualquer outro uso de signUp no cliente continua rejeitado.
  const signupCalls = [...source.matchAll(/\.auth\.signUp\s*\(/g)];
  if (!serverOnlyModule && signupCalls.length) {
    const migration = sqlByFile.get("fase221_cadastro_representante_aprovacao.sql") ?? "";
    const controlled =
      display.replaceAll("\\", "/") === "src/routes/auth.tsx" &&
      signupCalls.length === 1 &&
      source.includes("cadastro_representante_disponivel_221") &&
      source.includes("disponivel.data !== true") &&
      migration.includes("false,false,'pendente'") &&
      migration.includes("values(new.id,'representante')") &&
      migration.includes("not public.has_role(auth.uid(),'admin')") &&
      migration.includes("new.cadastro_status in ('pendente','recusado') and new.ativo");
    if (!controlled)
      errors.push(
        `${display}: cadastro público fora do fluxo pendente com aprovação administrativa da fase221`,
      );
  }

  for (const match of source.matchAll(/\.from\(\s*["']([^"']+)["']\s*\)/g)) {
    const table = match[1];
    if (forbiddenClientTables.has(table)) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      errors.push(
        `${display}:${line}: acesso direto a tabela sensível "${table}" no cliente; use função server-only`,
      );
    }
  }

  for (const match of source.matchAll(
    /\.from\(\s*["']([^"']+)["']\s*\)([\s\S]{0,500}?)\.(insert|update|delete|upsert)\s*\(/g,
  )) {
    const [, table, , operation] = match;
    if (protectedTables.has(table)) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      errors.push(
        `${display}:${line}: escrita direta ${operation.toUpperCase()} em tabela protegida "${table}"; use RPC controlada`,
      );
    }
  }
}

for (const rpc of [...rpcNames].sort()) {
  const filesWithRpc = [...sqlByFile.entries()].filter(([, sql]) =>
    sql.toLowerCase().includes(rpc.toLowerCase()),
  );

  if (filesWithRpc.length === 0) {
    errors.push(`RPC "${rpc}" usada no frontend, mas não encontrada nas migrations SQL`);
    continue;
  }

  const hardened = filesWithRpc.some(([, sql]) => {
    const lower = sql.toLowerCase();
    return (
      lower.includes("revoke execute on function") ||
      lower.includes("revoke all on function") ||
      (lower.includes("revoke") && lower.includes("execute") && lower.includes("public, anon"))
    );
  });

  if (!hardened) {
    errors.push(
      `RPC "${rpc}" usada no frontend sem evidência estática de REVOKE de PUBLIC/anon nas migrations que a referenciam`,
    );
  }
}

// Permissões financeiras devem falhar fechado e o cache precisa ser isolado por usuário.
{
  const file = "src/lib/permissoes-financeiras.ts";
  const source = readFileSync(file, "utf8");
  for (const required of ["user?.id", "if (error) throw new Error", "q.isError ? []"]) {
    if (!source.includes(required)) {
      errors.push(`${file}: proteção financeira esperada ausente: ${required}`);
    }
  }
}

if (errors.length) {
  console.error("Falhas no perímetro cliente/RPC:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Client security surface OK: ${sourceFiles.length} arquivos, ${rpcNames.size} RPCs e ${protectedTables.size} tabelas protegidas verificadas.`,
);
