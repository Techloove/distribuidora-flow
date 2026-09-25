import { readFileSync } from "node:fs";

const files = [
  "src/lib/consulta-cadastral.functions.ts",
  "src/lib/inscricao-estadual.functions.ts",
  "src/lib/sicredi.functions.ts",
  "src/lib/sicredi-config.functions.ts",
];

const errors = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");

  if (!source.includes("createServerFn")) {
    errors.push(`${file}: módulo sensível sem createServerFn`);
  }

  if (!source.includes("requireServerAuth")) {
    errors.push(`${file}: módulo sensível sem validação requireServerAuth`);
  }

  if (!source.includes("enforceRateLimit")) {
    errors.push(`${file}: módulo sensível sem rate limit`);
  }

  if (/VITE_[A-Z0-9_]*(?:SERVICE_ROLE|API_KEY|PASSWORD|SECRET)/.test(source)) {
    errors.push(`${file}: segredo sensível referenciado por variável VITE_*`);
  }

  if (source.includes("EXT_SUPABASE_SERVICE_ROLE_KEY")) {
    if (!source.includes("process.env")) {
      errors.push(`${file}: service role não está restrita ao ambiente do servidor`);
    }
    if (!source.includes("requireServerAuth")) {
      errors.push(`${file}: uso de service role sem autenticação prévia`);
    }
  }
}

const auth = readFileSync("src/lib/server-auth.ts", "utf8");

for (const required of [
  'if (!token) throw new Error("Sessão não informada. Entre novamente.")',
  "profiles[0]?.ativo !== true",
  "roles.size === 0",
  "allowedRoles.some",
  'getRequestHeader("authorization")',
]) {
  if (!auth.includes(required)) {
    errors.push(`src/lib/server-auth.ts: proteção esperada ausente: ${required}`);
  }
}

if (/EXT_SUPABASE_SERVICE_ROLE_KEY/.test(auth)) {
  errors.push("src/lib/server-auth.ts: autenticação de usuário não deve usar service_role");
}

if (errors.length) {
  console.error("Falhas no perímetro server-side:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Server security surface OK: ${files.length} módulos sensíveis verificados.`);
