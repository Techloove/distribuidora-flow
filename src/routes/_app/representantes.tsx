import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Representante e vendedor são um único cadastro (Cadastro Unificado).
 * A rota antiga permanece apenas para não quebrar links salvos.
 */
export const Route = createFileRoute("/_app/representantes")({
  beforeLoad: () => {
    throw redirect({ to: "/pessoas", replace: true });
  },
});
