/** Publica somente metadados de versão, sem dados ou credenciais do sistema. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const [atual] = JSON.parse(await readFile(new URL("src/content/versoes.json", root), "utf8"));
const manifesto = { versao: atual.versao, data: atual.data, titulo: atual.titulo };
if (process.argv.includes("--finalizar")) {
  const publicado = JSON.parse(await readFile(new URL(".output/public/versao.json", root), "utf8"));
  if (JSON.stringify(publicado) !== JSON.stringify(manifesto))
    throw new Error("A versão pública do build diverge da versão do código.");
  const file = new URL(".output/public/_headers", root);
  let headers = await readFile(file, "utf8").catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return "";
  });
  headers = headers.replace(/\n?\/versao\.json\r?\n(?:[ \t]+[^\n]*(?:\n|$))*/g, "").trimEnd();
  await writeFile(
    file,
    headers +
      "\n\n/versao.json\n  Cache-Control: no-store, no-cache, must-revalidate\n  CDN-Cache-Control: no-store\n",
  );
  console.log(
    `Versão ${atual.versao}: manifesto do build conferido e consulta sem cache configurada.`,
  );
} else {
  await mkdir(new URL("public/", root), { recursive: true });
  await writeFile(new URL("public/versao.json", root), JSON.stringify(manifesto) + "\n");
  console.log(`Manifesto público da versão ${atual.versao} gerado.`);
}
