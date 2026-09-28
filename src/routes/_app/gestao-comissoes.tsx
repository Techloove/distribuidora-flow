import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/gestao-comissoes")({
  // Tela unificada: a gestão de comissões passou a ser a própria tela de Comissões.
  beforeLoad: () => {
    throw redirect({ to: "/comissoes" });
  },
});
