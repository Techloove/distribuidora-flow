// Detecta campos de calendário exibidos diretamente em JSX e mensagens de interface.
// Não reescreve dados e não confunde valores técnicos de inputs, chaves ou APIs com rótulos.
import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

function ocorrencias(source, file) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const result = [];
  const campo = (n) =>
    ts.isElementAccessExpression(n) &&
    n.argumentExpression &&
    ts.isStringLiteral(n.argumentExpression)
      ? n.argumentExpression.text
      : ts.isPropertyAccessExpression(n)
        ? n.name.text
        : "";
  const campoData = (s) =>
    /^(data_.+|vencimento(?:_.+)?|competencia|proxima_acao|previsao_entrega|vigencia_(?:inicio|fim)|periodo_(?:inicio|fim)|status_regularizado_data|mes|.+_(?:at|em))$/.test(
      s,
    );
  const cru = (n) => {
    if (!n) return false;
    // O mapa nomes contém rótulos de campos, não valores de calendário.
    if (ts.isPropertyAccessExpression(n) && n.expression.getText(sf) === "nomes") return false;
    if (campoData(campo(n))) return true;
    if (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n))
      return cru(n.expression);
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "String") return cru(n.arguments[0]);
    return (
      ts.isBinaryExpression(n) &&
      [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(
        n.operatorToken.kind,
      ) &&
      (cru(n.left) || cru(n.right))
    );
  };
  const contextoExibicao = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isJsxAttribute(p) || ts.isJsxSpreadAttribute(p)) return false;
      if (ts.isNewExpression(p) && p.expression.getText(sf) === "Date") return false;
      if (ts.isJsxExpression(p)) return !ts.isJsxAttribute(p.parent);
      if (
        ts.isPropertyAssignment(p) &&
        ["detalhe", "mensagem"].includes(p.name.getText(sf).replace(/['"]/g, ""))
      )
        return true;
      if (ts.isReturnStatement(p) && file.endsWith("pendencias-exibicao.ts")) return true;
    }
    return false;
  };
  const visit = (n) => {
    if (
      (ts.isJsxExpression(n) &&
        n.expression &&
        !ts.isJsxAttribute(n.parent) &&
        cru(n.expression)) ||
      (ts.isTemplateSpan(n) && cru(n.expression) && contextoExibicao(n))
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
      result.push(`${file}:${line + 1}: ${n.getText(sf).replace(/\s+/g, " ").slice(0, 130)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return result;
}
// Prova que a verificação pega a regressão do dashboard sem bloquear filtros ISO.
assert.equal(ocorrencias('const x = <p>{String(r["vencimento"])}</p>', "exemplo.tsx").length, 1);
assert.equal(
  ocorrencias('const x = {detalhe: `Vencimento ${r["vencimento"]}`}', "exemplo.ts").length,
  1,
);
assert.equal(ocorrencias('const x = <p>{r.competencia ?? "—"}</p>', "exemplo.tsx").length, 1);
assert.equal(
  ocorrencias(
    'const x = <input type="date" value={r.vencimento} min={r.data_pedido} key={`${r.mes}`} />',
    "exemplo.tsx",
  ).length,
  0,
);
assert.equal(
  ocorrencias("const x = <p>{dataBr(r.vencimento)} {mesBr(r.competencia)}</p>", "exemplo.tsx")
    .length,
  0,
);
const problems = [];
let files = 0;
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (/\.tsx?$/.test(file)) {
      files++;
      problems.push(...ocorrencias(readFileSync(file, "utf8"), file));
    }
  }
}
scan("src");
if (problems.length) {
  console.error(
    "Datas exibidas sem formatação brasileira. Use dataBr/mesBr na apresentação:\n" +
      problems.join("\n"),
  );
  process.exitCode = 1;
} else
  console.log(
    `Datas: ${files} arquivos revisados; nenhuma exibição direta de campos de calendário detectada.`,
  );
