import { createFileRoute, redirect } from "@tanstack/react-router";

/** Cadastro único: preserva os links antigos sem permitir edição da cópia especializada. */
export const Route = createFileRoute("/_app/fornecedores")({
  beforeLoad: () => {
    throw redirect({ to: "/pessoas", replace: true });
  },
});
