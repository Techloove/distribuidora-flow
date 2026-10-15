import { createFileRoute, Navigate } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/relatorios")({
  component: () => <Navigate to="/relatorio-vendas" replace />,
});
