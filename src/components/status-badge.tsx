export function StatusBadge({ value }: { value: unknown }) {
  const status = String(value ?? "—");
  const tone = ["pago", "liquidado", "confirmado", "registrado", "entregue", "aprovado"].includes(
    status,
  )
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : ["erro", "recusado", "rejeitado", "vencido", "divergente"].includes(status)
      ? "bg-red-500/10 text-red-700 dark:text-red-300"
      : ["parcial", "pendente", "em_processamento", "aguardando_aprovacao", "incerto"].includes(
            status,
          )
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {status === "venda_nao_aprovada" ? "Venda não aprovada" : status.replace(/_/g, " ")}
    </span>
  );
}
