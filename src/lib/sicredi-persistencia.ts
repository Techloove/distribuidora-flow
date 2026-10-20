/** Não expõe details/hint/corpo SQL, que podem conter dados privados. */
export function erroPersistenciaSicredi(fn: string, status: number, body: string): string {
  let code = "";
  try {
    const error = JSON.parse(body);
    if (error.code === "P0001" && typeof error.message === "string") return error.message;
    if (typeof error.code === "string" && /^[A-Z0-9]{5,9}$/.test(error.code)) code = error.code;
  } catch {
    // Respostas HTML de infraestrutura não são exibidas.
  }
  const operation = /^[a-z][a-z0-9_]{0,80}$/.test(fn) ? fn : "operacao";
  const reason = ["PGRST202", "42883"].includes(code)
    ? "Rotina do banco ausente ou desatualizada."
    : code === "42501"
      ? "Permissão insuficiente no banco."
      : ["42P01", "42703"].includes(code)
        ? "Estrutura do banco incompatível com a rotina."
        : ["23502", "23503", "23505", "23514"].includes(code)
          ? "O banco bloqueou a gravação por uma regra de integridade."
          : "O Supabase não concluiu a operação.";
  return `${reason} Referência: ${operation} (${code || `HTTP ${status}`}). Confira o diagnóstico Sicredi; não é uma confirmação de quitação.`;
}
