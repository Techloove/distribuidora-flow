import { test, expect } from "bun:test";
import ts from "typescript";
import { readFileSync } from "node:fs";

test("componentes irmãos do documento não compartilham a mesma chave de reconciliação", () => {
  const source = readFileSync(
    new URL("../src/components/documento-page.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "documento-page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let keyedSiblings = 0;
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const keys: string[] = [];
      for (const child of node.children) {
        let element: ts.Node = child;
        if (ts.isJsxExpression(element) && element.expression) element = element.expression;
        while (ts.isParenthesizedExpression(element) || ts.isBinaryExpression(element)) {
          element = ts.isParenthesizedExpression(element) ? element.expression : element.right;
        }
        const opening = ts.isJsxElement(element)
          ? element.openingElement
          : ts.isJsxSelfClosingElement(element)
            ? element
            : null;
        const key = opening?.attributes.properties.find(
          (p) => ts.isJsxAttribute(p) && p.name.getText(ast) === "key",
        );
        if (key && ts.isJsxAttribute(key) && key.initializer)
          keys.push(key.initializer.getText(ast));
      }
      if (keys.length > 1) {
        keyedSiblings++;
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(keyedSiblings).toBeGreaterThan(0);
});
