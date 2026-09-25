import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dbDir = "db";
const files = readdirSync(dbDir).filter((name) => name.endsWith(".sql")).sort();
const errors = [];

for (const file of files) {
  const path = join(dbDir, file);
  const sql = readFileSync(path, "utf8");
  const lines = sql.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (/^as\s+\$\s*$/i.test(trimmed) || /^\$\s*;$/.test(trimmed)) {
      errors.push(`${file}:${index + 1}: delimitador SQL inválido; use $ ... $;`);
    }
  });

  // Verifica dollar-quotes desbalanceados sem se confundir com strings/comentários comuns.
  // Isso captura casos como AS $ ... sem o $ final, que TypeScript/lint não detectam.
  {
    let i = 0;
    let state = "normal";
    let dollarTag = null;
    let blockDepth = 0;

    while (i < sql.length) {
      if (state === "dollar") {
        if (sql.startsWith(dollarTag, i)) {
          i += dollarTag.length;
          state = "normal";
          dollarTag = null;
        } else { i += 1; }
        continue;
      }

      if (state === "single") {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") { i += 1; state = "normal"; }
        else i += 1;
        continue;
      }

      if (state === "lineComment") {
        if (sql[i] === "\n") state = "normal";
        i += 1;
        continue;
      }

      if (state === "blockComment") {
        if (sql.startsWith("/*", i)) { blockDepth += 1; i += 2; }
        else if (sql.startsWith("*/", i)) { blockDepth -= 1; i += 2; if (blockDepth === 0) state = "normal"; }
        else i += 1;
        continue;
      }

      if (sql.startsWith("--", i)) { state = "lineComment"; i += 2; continue; }
      if (sql.startsWith("/*", i)) { state = "blockComment"; blockDepth = 1; i += 2; continue; }
      if (sql[i] === "'") { state = "single"; i += 1; continue; }

      const match = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) { dollarTag = match[0]; state = "dollar"; i += dollarTag.length; continue; }
      i += 1;
    }

    if (state === "dollar" && dollarTag) {
      errors.push(file + ': dollar-quote não fechado (' + dollarTag + ')');
    }
  }
  const chunks = sql.split(/(?=create\s+(?:or\s+replace\s+)?function\s+)/gi);
  for (const chunk of chunks) {
    if (!/create\s+(?:or\s+replace\s+)?function/i.test(chunk)) continue;
    const headerEnd = chunk.search(/\bas\s+\$[A-Za-z0-9_]*\$/i);
    const header = headerEnd >= 0 ? chunk.slice(0, headerEnd) : chunk;
    if (/security\s+definer/i.test(header) && !/set\s+search_path\s*(?:=|to)\s*/i.test(header)) {
      const name = header.match(/function\s+([^\s(]+)/i)?.[1] ?? "função desconhecida";
      errors.push(`${file}: SECURITY DEFINER sem SET search_path explícito em ${name}`);
    }
  }
}

if (errors.length) {
  console.error("Falhas de segurança/sintaxe SQL detectadas:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`SQL guard OK: ${files.length} migrations verificadas.`);
