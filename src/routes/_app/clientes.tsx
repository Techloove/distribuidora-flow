import { createFileRoute, redirect } from "@tanstack/react-router";

/** Clientes fazem parte do Cadastro Unificado: a tela antiga leva direto para ele. */
export const Route = createFileRoute("/_app/clientes")({
  beforeLoad: () => {
    throw redirect({ to: "/pessoas" });
  },
});
