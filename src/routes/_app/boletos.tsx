import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/boletos")({
  // Tela unificada: boletos passaram a ser emitidos e acompanhados em /faturamento.
  beforeLoad: () => {
    throw redirect({ to: "/faturamento" });
  },
});
