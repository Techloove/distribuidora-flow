import { CheckCircle2, AlertTriangle } from "lucide-react";
import { brl } from "@/lib/formatacao";
export function ResumoPedido({
  doc,
  peso,
  avisos,
  carregando,
}: {
  doc: Record<string, unknown>;
  peso: number;
  avisos: string[];
  carregando: boolean;
}) {
  const valores = [
    ["Peso", `${peso.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`],
    ["Itens", brl(doc["total_itens"])],
    [
      "Descontos",
      brl(Number(doc["desconto_valor"] ?? 0) + Number(doc["forma_desconto_valor"] ?? 0)),
    ],
    ["Frete manual", brl(doc["frete_valor"])],
    ["Frete por volume", brl(doc["frete_volume_valor"])],
    ["Outras despesas", brl(doc["outras_despesas"])],
    ["Total", brl(doc["total_liquido"])],
  ];
  return (
    <aside
      aria-label="Resumo do pedido"
      className="no-print sm:sticky sm:top-0 sm:z-20 rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {valores.map(([label, value]) => (
          <div key={label}>
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p
              className={`break-words text-sm font-semibold ${label === "Total" ? "text-primary" : ""}`}
            >
              {carregando && label === "Peso" ? "…" : value}
            </p>
          </div>
        ))}
      </div>
      <details className="mt-2 border-t pt-2" open={avisos.length > 0}>
        <summary
          className={`cursor-pointer text-xs font-medium ${avisos.length ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}
        >
          <span className="inline-flex items-center gap-1.5">
            {avisos.length ? (
              <AlertTriangle className="size-3.5" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            {carregando
              ? "Conferindo itens…"
              : avisos.length
                ? `${avisos.length} pendência(s) antes de confirmar`
                : "Dados essenciais preenchidos"}
          </span>
        </summary>
        {avisos.length ? (
          <ul className="mt-2 space-y-1 text-xs">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Valores salvos no pedido. As regras de crédito e estoque continuam sendo conferidas na
            confirmação.
          </p>
        )}
      </details>
    </aside>
  );
}
