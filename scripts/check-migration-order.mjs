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

// A branch antiga do Codex (codex/erp-seguranca-layout) partiu de uma base anterior
// ao hardening atual. Estas migrations foram reconciliadas em fases posteriores e
// não podem reaparecer por merge/cherry-pick, pois reutilizam números/assinaturas
// antigas e podem sobrescrever regras mais novas.
const staleCodexMigrations = [
  "fase79_seguranca_acesso.sql",
  "fase80_dashboard_resumo.sql",
  "fase81_liquidacao_boleto.sql",
];

for (const file of staleCodexMigrations) {
  if (files.includes(file)) {
    errors.push(
      `migration Codex legada não deve ser reintroduzida: ${file}; use as fases reconciliadas 100+/148/151/152/153`,
    );
  }
}
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
  "fase121_hardening_idempotencia_sicredi.sql",
  "fase123_persistencia_sicredi_server_only.sql",
  "fase127_sicredi_config_server_only.sql",
  "fase129_idempotencia_persistencia_sicredi.sql",
  "fase130_hardening_admin_limpar_dados.sql",
  "fase131_reserva_emissao_sicredi.sql",
  "fase133_hardening_rate_limit.sql",
  "fase135_sicredi_config_singleton.sql",
  "fase136_preflight_reconciliacao_codex.sql",
  "fase139_preflight_idempotencia_concorrencia.sql",
  "fase140_preflight_devolucao_credito.sql",
  "fase141_protecao_tabelas_internas.sql",
  "fase144_preflight_security_definer_global.sql",
  "fase147_gate_final_homologacao.sql",
  "fase148_gate_revisao_codex.sql",
  "fase149_user_roles_escrita_controlada.sql",
  "fase150_rls_compras_itens.sql",
  "fase151_dashboard_resumo_centro.sql",
  "fase152_liquidacao_boleto_idempotente.sql",
  "fase153_preflight_codex_dashboard_boleto.sql",
  "fase159_hardening_search_path_helpers.sql",
  "fase160_revoke_execute_trigger_functions.sql",
  "fase163_rls_restrictive_default_deny.sql",
  "fase166_minimo_privilegio_tabelas.sql",
  "fase167_default_deny_notas_saida.sql",
  "fase168_gate_fiscal_minimo_privilegio.sql",
  "fase169_dashboard_rankings.sql",
  "fase180_preflight_lote_c.sql",
  "fase181_gate_lote_c.sql",
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
