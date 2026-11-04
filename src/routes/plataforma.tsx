import { createFileRoute } from "@tanstack/react-router";
import { PainelSaas } from "@/components/painel-saas";
export const Route = createFileRoute("/plataforma")({
  ssr: false,
  head: () => ({ meta: [{ title: "Painel SaaS — Caparaó System" }] }),
  component: () => <PainelSaas administracao />,
});
