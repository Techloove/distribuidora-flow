import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/lead-rota")({
  beforeLoad: () => {
    throw redirect({ to: "/agenda-comercial", search: { aba: "rotas" }, replace: true });
  },
});
