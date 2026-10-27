import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAcesso } from "@/lib/permissoes";
import { destinoReferencia, type TipoReferencia } from "@/lib/referencias-registros";

/** Apenas navega. O destino mantém suas consultas autenticadas e suas permissões. */
export function ReferenciaRegistro({
  tipo,
  id,
  children,
}: {
  tipo: TipoReferencia;
  id: unknown;
  children: ReactNode;
}) {
  const acesso = useAcesso();
  const destino = destinoReferencia(tipo, id);
  if (!destino || acesso.carregando || acesso.erro || !acesso.pode(destino.to))
    return <>{children}</>;
  return (
    <Link
      {...destino}
      className="rounded-sm font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 print:text-inherit print:no-underline"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </Link>
  );
}
