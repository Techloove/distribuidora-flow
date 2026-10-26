import { textoManual } from "./gerar-manual.mjs";
import { readFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const pacote = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const historico = JSON.parse(await readFile(new URL("src/content/versoes.json", root), "utf8"));
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
if (!Array.isArray(historico) || !historico.length || pacote.version !== historico[0].versao)
  throw new Error("A versão do pacote deve coincidir com a versão atual do histórico.");
let anterior = null;
const vistos = new Set();
for (const v of historico) {
  if (
    !semver.test(v.versao) ||
    vistos.has(v.versao) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v.data) ||
    !v.titulo?.trim() ||
    !Array.isArray(v.novidades) ||
    !v.novidades.length ||
    v.novidades.some((n) => typeof n !== "string" || !n.trim())
  )
    throw new Error("Histórico de versões inválido.");
  const data = new Date(v.data + "T00:00:00Z");
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== v.data)
    throw new Error("Data de versão inválida.");
  const partes = v.versao.split(".").map(Number);
  if (
    anterior &&
    !(
      anterior[0] > partes[0] ||
      (anterior[0] === partes[0] &&
        (anterior[1] > partes[1] || (anterior[1] === partes[1] && anterior[2] > partes[2])))
    )
  )
    throw new Error("Ordene o histórico da versão mais recente para a mais antiga.");
  vistos.add(v.versao);
  anterior = partes;
}
const manual = JSON.parse(await readFile(new URL("src/content/manual.json", root), "utf8"));
const ids = new Set();
for (const t of manual) {
  if (
    !/^[a-z0-9-]+$/.test(t.id) ||
    ids.has(t.id) ||
    ![t.titulo, t.grupo, t.resumo].every((x) => typeof x === "string" && x.trim()) ||
    ![t.passos, t.cuidados].every(
      (a) => Array.isArray(a) && a.length && a.every((x) => typeof x === "string" && x.trim()),
    ) ||
    !Array.isArray(t.modulos)
  )
    throw new Error("Assunto inválido ou duplicado no manual.");
  ids.add(t.id);
}
if ((await readFile(new URL("docs/manual-do-usuario.md", root), "utf8")) !== (await textoManual()))
  throw new Error("Atualize a cópia do manual com npm run manual:gerar.");
console.log(`Versão ${pacote.version} OK: pacote e histórico consistentes.`);
