import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dbDir = "db";
const files = readdirSync(dbDir)
  .filter((name) => /^fase\d+_.+\.sql$/i.test(name))
  .sort((a, b) => {
    const na = Number(a.match(/^fase(\d+)_/i)?.[1] ?? 0);
    const nb = Number(b.match(/^fase(\d+)_/i)?.[1] ?? 0);
    return na - nb || a.localeCompare(b);
  });

const errors = [];
const required = [
  "fase54_hardening_seguranca.sql",
  "fase55_estoque_por_centro.sql",
  "fase61_hardening_cancelamentos_devolucoes.sql",
  "fase64_idempotencia_transferencias.sql",
  "fase70_integridade_compras_financeiro.sql",
  "fase80_credito_cliente_devolucao.sql",
  "fase81_hardening_crud_pedidos.sql",
  "fase87_expedicao_escrita_controlada.sql",
  "fase99_revoke_public_rpc_criticas.sql",
  "fase100_codex_hardening_acesso.sql",
  "fase147_gate_final_homologacao.sql",
  "fase159_hardening_search_path_helpers.sql",
  "fase160_revoke_execute_trigger_functions.sql",
  "fase163_rls_restrictive_default_deny.sql",
];

for (const file of required) {
  if (!files.includes(file)) errors.push(`migration obrigatória ausente: ${file}`);
}

for (const file of files) {
  const sql = readFileSync(join(dbDir, file), "utf8").toLowerCase();
  const hasBegin = /(^|\n)\s*begin\s*;/m.test(sql);
  const hasCommit = /(^|\n)\s*commit\s*;/m.test(sql);
  if (hasBegin !== hasCommit) {
    errors.push(`${file}: transação incompleta; BEGIN/COMMIT devem aparecer juntos`);
  }
}

const groups = new Map();
for (const file of files) {
  const n = Number(file.match(/^fase(\d+)_/i)?.[1] ?? 0);
  const arr = groups.get(n) ?? [];
  arr.push(file);
  groups.set(n, arr);
}

if (errors.length) {
  console.error("Falhas na sequência de migrations:");
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

console.log(`Migration order OK: ${files.length} arquivos fase* verificados.`);
console.log("Ordem determinística: número da fase crescente; empate por nome de arquivo.");
for (const [n, group] of [...groups.entries()].filter(([, g]) => g.length > 1)) {
  console.log(`Fase ${n} possui ${group.length} arquivos: ${group.join(", ")}`);
}
