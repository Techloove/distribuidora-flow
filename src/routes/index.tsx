import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Entrada — Caparaó System" },
    { name: "description", content: "Acesse o Caparaó System para gerenciar pedidos, entregas e financeiro." },
    { property: "og:title", content: "Entrada — Caparaó System" },
    { property: "og:description", content: "Acesso ao sistema de gestão Caparaó." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: () => {
    throw redirect({ to: "/auth", replace: true });
  },
});
