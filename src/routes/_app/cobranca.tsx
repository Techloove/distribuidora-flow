import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/cobranca")({
  beforeLoad: () => {
    throw redirect({ to: "/agenda-comercial", search: { aba: "cobranca" }, replace: true });
  },
});
