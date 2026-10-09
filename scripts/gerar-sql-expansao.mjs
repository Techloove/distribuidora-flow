// Gera um único comando transacional para a implantação manual após fase211.
import { readFile, writeFile, readdir } from "node:fs/promises";
const files = (await readdir("db")).filter((f) => /^fase(21[2-9]|220)_.*\.sql$/.test(f)).sort();
if (files.length !== 9) throw new Error("São necessárias exatamente as fases212–220.");
let sql =
  "-- Implantação das fases212–220. Pré-requisito: fase211 aplicada.\n-- Execute o arquivo inteiro no SQL Editor do Supabase, papel postgres.\n-- Mantenha RLS ativado. Não execute partes selecionadas.\nbegin;\n";
for (const f of files) {
  const source = await readFile("db/" + f, "utf8");
  if (!/^begin;$/m.test(source) || !/^commit;$/m.test(source))
    throw new Error("Transação ausente: " + f);
  sql +=
    "\n-- Fonte: " + f + "\n" + source.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "");
}
await writeFile("db/implantacao_fases212_a220.sql", sql + "\ncommit;\n");
console.log("SQL único gerado: db/implantacao_fases212_a220.sql");
