/** Publica somente metadados de versão, sem dados ou credenciais do sistema. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const [atual] = JSON.parse(await readFile(new URL("src/content/versoes.json", root), "utf8"));
const manifesto = { versao: atual.versao, data: atual.data, titulo: atual.titulo };
if (process.argv.includes("--finalizar")) {
  const { access } = await import("node:fs/promises");
  let saida = null;
  // A Vercel usa Build Output API, não o diretório público do Cloudflare.
  // Quando o destino está explícito, não aceite uma saída antiga de outro build.
  const vercel = process.env.VERCEL === "1" || process.env.NITRO_PRESET?.startsWith("vercel");
  const diretorios = vercel
    ? [".vercel/output/static/"]
    : ["dist/client/", ".output/public/", ".vercel/output/static/"];
  for (const dir of diretorios) {
    try {
      await access(new URL(dir + "versao.json", root));
      saida = dir;
      break;
    } catch {}
  }
  if (!saida) throw new Error("Manifesto versao.json não encontrado na saída do build.");
  const publicado = JSON.parse(await readFile(new URL(saida + "versao.json", root), "utf8"));
  if (JSON.stringify(publicado) !== JSON.stringify(manifesto))
    throw new Error("A versão pública do build diverge da versão do código.");
  if (saida === ".vercel/output/static/") {
    // _headers é interpretado pelo Cloudflare, mas não pela Vercel.
    // A regra deve vir antes do filesystem para valer também para o JSON estático.
    const file = new URL(".vercel/output/config.json", root);
    const config = JSON.parse(await readFile(file, "utf8"));
    if (config.version !== 3 || !Array.isArray(config.routes))
      throw new Error("Configuração de saída da Vercel inválida.");
    const src = "^/versao\\.json$";
    config.routes = [
      {
        src,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "CDN-Cache-Control": "no-store",
          "Vercel-CDN-Cache-Control": "no-store",
        },
        continue: true,
      },
      ...config.routes.filter((route) => route.src !== src),
    ];
    await writeFile(file, JSON.stringify(config, null, 2) + "\n");
  } else {
    const file = new URL(saida + "_headers", root);
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
  }
  console.log(
    `Versão ${atual.versao}: manifesto do build conferido e consulta sem cache configurada.`,
  );
} else {
  await mkdir(new URL("public/", root), { recursive: true });
  await writeFile(new URL("public/versao.json", root), JSON.stringify(manifesto) + "\n");
  console.log(`Manifesto público da versão ${atual.versao} gerado.`);
}
