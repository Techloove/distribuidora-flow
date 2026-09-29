import { readFileSync } from "node:fs";

const files = [
  "src/lib/consulta-cadastral.functions.ts",
  "src/lib/inscricao-estadual.functions.ts",
  "src/lib/sicredi.functions.ts",
  "src/lib/sicredi-config.functions.ts",
];

const errors = [];

// O PR Codex #2 introduziu auth.server.ts/auth-middleware.ts em uma arquitetura anterior.
// A branch auditada consolidou autenticação server-side em server-auth.ts; reintroduzir os
// dois mecanismos paralelos pode criar divergência de regras e bypass acidental.
for (const stale of ["src/lib/auth.server.ts", "src/lib/auth-middleware.ts"]) {
  try {
    readFileSync(stale, "utf8");
    errors.push(`${stale}: mecanismo legado/paralelo de autenticação não deve ser reintroduzido; use src/lib/server-auth.ts`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

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
