// Regressões de negócio em bancos PGlite descartáveis, sem conectar ao Supabase.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const scripts = readdirSync(join(root, "scripts"))
  .filter(
    (file) =>
      /^check-.+\.cjs$/.test(file) &&
      readFileSync(join(root, "scripts", file), "utf8").includes("PGlite"),
  )
  .sort();
if (!scripts.length) throw new Error("Nenhuma suíte de banco local encontrada.");
let next = 0;
const results = [];
async function worker() {
  while (next < scripts.length) {
    const file = scripts[next++];
    const start = Date.now();
    const result = await new Promise((resolve) => {
      let output = "";
      const child = spawn(process.execPath, [join(root, "scripts", file)], {
        cwd: root,
        env: process.env,
        timeout: 120_000,
        killSignal: "SIGKILL",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const collect = (data) => {
        output = (output + data.toString()).slice(-32_000);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", (error) => {
        output += `\n${error.message}`;
      });
      child.on("close", (code, signal) => resolve({ file, ok: code === 0, output, signal }));
    });
    results.push(result);
    console.log(
      `${result.ok ? "OK" : "FALHOU"} ${file} (${((Date.now() - start) / 1000).toFixed(1)}s)`,
    );
    if (!result.ok) console.error(result.output, result.signal ?? "");
  }
}
await Promise.all(Array.from({ length: Math.min(3, scripts.length) }, worker));
const failed = results.filter((result) => !result.ok);
console.log(
  `${results.length - failed.length}/${results.length} suítes de negócio aprovadas em banco local descartável.`,
);
if (failed.length) process.exitCode = 1;
