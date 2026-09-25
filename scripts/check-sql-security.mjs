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
    if (trimmed === "as $" || trimmed === "$;") {
      errors.push(`${file}:${index + 1}: delimitador SQL inválido; use $$ ... $$;`);
    }
  });

  const chunks = sql.split(/(?=create\s+or\s+replace\s+function\s+)/gi);
  for (const chunk of chunks) {
    if (!/create\s+or\s+replace\s+function/i.test(chunk)) continue;
    const headerEnd = chunk.search(/\bas\s+\$\$/i);
    const header = headerEnd >= 0 ? chunk.slice(0, headerEnd) : chunk;
    if (/security\s+definer/i.test(header) && !/set\s+search_path\s*=/i.test(header)) {
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
