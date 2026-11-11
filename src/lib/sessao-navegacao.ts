import type { AuthChangeEvent } from "@supabase/supabase-js";

/** SIGNED_IN também ocorre ao retomar uma aba já autenticada. */
export function deveRevalidarNavegacao(
  evento: AuthChangeEvent,
  usuarioAnterior: string | null | undefined,
  usuarioAtual: string | null,
): boolean {
  return (
    evento === "SIGNED_OUT" ||
    evento === "USER_UPDATED" ||
    (evento === "SIGNED_IN" && usuarioAnterior !== usuarioAtual)
  );
}
