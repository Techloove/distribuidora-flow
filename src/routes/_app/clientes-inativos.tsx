import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/clientes-inativos")({
  beforeLoad: () => {
    throw redirect({ to: "/agenda-comercial", search: { aba: "reativacao" }, replace: true });
  },
});
