import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/faturamento")({
  beforeLoad: () => {
    throw redirect({ to: "/boletos", replace: true });
  },
});
