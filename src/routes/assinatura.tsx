import { createFileRoute } from "@tanstack/react-router";
import { PainelSaas } from "@/components/painel-saas";
export const Route = createFileRoute("/assinatura")({
  ssr: false,
  head: () => ({ meta: [{ title: "Minha assinatura — Caparaó System" }] }),
  component: () => <PainelSaas />,
});
