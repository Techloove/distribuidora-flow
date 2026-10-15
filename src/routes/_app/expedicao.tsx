import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/expedicao")({
  beforeLoad: () => {
    throw redirect({ to: "/entregas" });
  },
});
