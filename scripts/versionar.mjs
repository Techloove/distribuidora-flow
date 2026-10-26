import "./check-version.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { gerarManual } from "./gerar-manual.mjs";
const root = new URL("../", import.meta.url);
const tipo = process.argv[2],
  resumo = process.argv.slice(3).join(" ").trim();
if (!["patch", "minor", "major"].includes(tipo) || !resumo)
  throw new Error('Use npm run version:patch -- "Resumo da atualização" (ou minor/major).');
const packageFile = new URL("package.json", root),
  historyFile = new URL("src/content/versoes.json", root);
const pacote = JSON.parse(await readFile(packageFile, "utf8")),
  historico = JSON.parse(await readFile(historyFile, "utf8"));
if (pacote.version !== historico[0]?.versao || !/^\d+\.\d+\.\d+$/.test(pacote.version))
  throw new Error("Confira a versão atual antes de gerar a próxima.");
let [major, minor, patch] = pacote.version.split(".").map(Number);
if (tipo === "major") {
  major++;
  minor = 0;
  patch = 0;
} else if (tipo === "minor") {
  minor++;
  patch = 0;
} else patch++;
const versao = [major, minor, patch].join("."),
  data = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
pacote.version = versao;
historico.unshift({ versao, data, titulo: resumo, novidades: [resumo] });
await writeFile(packageFile, JSON.stringify(pacote, null, 2) + "\n");
await writeFile(historyFile, JSON.stringify(historico, null, 2) + "\n");
await gerarManual();
console.log(
  `Versão ${versao} preparada. Revise as novidades, execute os testes e publique pelo fluxo normal. Nenhum commit ou envio foi realizado.`,
);
