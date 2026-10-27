import { Link } from "@tanstack/react-router";
import type { BuscaReferencias } from "@/lib/referencias-registros";

export function ContextoReferencia({
  busca,
  to,
}: {
  busca?: BuscaReferencias | undefined;
  to: "/receber" | "/pagar" | "/boletos";
}) {
  if (!busca || !Object.values(busca).some(Boolean)) return null;
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3 text-sm"
    >
      <span>
        Exibindo registros relacionados. Os filtros de loja e as permissões de acesso continuam
        valendo.
      </span>
      <Link to={to} search={{}} className="font-medium text-primary underline">
        Ver todos
      </Link>
    </div>
  );
}
