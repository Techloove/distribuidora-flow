import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = new URL("../", import.meta.url);
export async function textoManual() {
  const topicos = JSON.parse(await readFile(new URL("src/content/manual.json", root), "utf8"));
  const [atual] = JSON.parse(await readFile(new URL("src/content/versoes.json", root), "utf8"));
  const texto =
    `# Manual do usuário — Caparaó System\n\nVersão ${atual.versao} · ${atual.data}\n\nEste manual orienta o uso; não concede acesso aos módulos. Consulte a versão atual em Ajuda → Manual do usuário no sistema.\n\n` +
    topicos
      .map(
        (t) =>
          `## ${t.titulo}\n\n${t.resumo}\n\n${t.passos.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nCuidados:\n\n${t.cuidados.map((c) => `- ${c}`).join("\n")}`,
      )
      .join("\n\n") +
    "\n";
  return texto;
}
export async function gerarManual() {
  await writeFile(new URL("docs/manual-do-usuario.md", root), await textoManual());
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await gerarManual();
  console.log("Manual atualizado em docs/manual-do-usuario.md");
}
