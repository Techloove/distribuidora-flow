import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** Um temporizador na área autenticada; observa somente consultas de acesso já ativas. */
export function useSincronizacaoPermissoes() {
  const qc = useQueryClient();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || navigator.onLine === false) return;
      void qc.refetchQueries(
        {
          type: "active",
          predicate: (q) =>
            ["role_menus", "minhas_permissoes"].includes(String(q.queryKey[0])) &&
            q.state.fetchStatus !== "fetching",
        },
        { cancelRefetch: false },
      );
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [qc]);
}
