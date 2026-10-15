import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/planejamento-compras")({
  beforeLoad: () => {
    throw redirect({ to: "/compras", search: { aba: "planejamento" }, replace: true });
  },
});
