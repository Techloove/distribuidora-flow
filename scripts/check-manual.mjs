import { readFile, readdir } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const manual = JSON.parse(await readFile(new URL("src/content/manual.json", root), "utf8"));
const files = (await readdir(new URL("src/routes/_app/", root))).filter(
  (f) => f.endsWith(".tsx") && f !== "route.tsx",
);
const paths = new Set(files.map((f) => "/" + f.replace(/\.tsx$/, "")));
const covered = new Set(manual.flatMap((t) => t.modulos));
const permissoes = await readFile(new URL("src/lib/permissoes.ts", root), "utf8");
const bloco = /const ALIASES[^=]*= \{([\s\S]*?)\};/.exec(permissoes)?.[1] ?? "";
const aliases = Object.fromEntries(
  [...bloco.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]),
);

for (const p of covered) if (!paths.has(p)) throw Error("Atalho inexistente no manual: " + p);
const missing = [];
for (const f of files) {
  const code = await readFile(new URL("src/routes/_app/" + f, root), "utf8");
  if (/throw redirect\(|<Navigate\s/.test(code)) continue;
  const path = "/" + f.replace(/\.tsx$/, "");
  if (path === "/ajuda" && manual.some((t) => t.id === "manual-versoes")) continue;
  if (!covered.has(aliases[path] ?? path)) missing.push(path);
}
if (missing.length) throw Error("Telas sem orientação no manual: " + missing.join(", "));
console.log(
  `Manual: ${manual.length} assuntos, ${covered.size} telas/atalhos documentados; nenhuma tela operacional sem cobertura.`,
);
