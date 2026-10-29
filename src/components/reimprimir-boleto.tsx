import { ImprimirBoletos } from "@/components/imprimir-boletos";
import { boletoImprimivel } from "@/lib/boletos-documento";
import { useSupabase } from "@/lib/supabase-provider";

export function ReimprimirBoleto({ boleto }: { boleto: Record<string, unknown> }) {
  const { roles } = useSupabase();
  if (
    !roles.some((r) => ["admin", "gestor", "financeiro"].includes(r)) ||
    !boletoImprimivel({
      banco: String(boleto["banco"]),
      canal: String(boleto["canal"]),
      status: String(boleto["status"]),
      linha_digitavel:
        typeof boleto["linha_digitavel"] === "string" ? boleto["linha_digitavel"] : null,
    })
  )
    return null;
  return (
    <ImprimirBoletos
      boletoId={String(boleto["id"])}
      contaId={boleto["conta_receber_id"] ? String(boleto["conta_receber_id"]) : undefined}
      pedidoId={boleto["pedido_id"] ? String(boleto["pedido_id"]) : undefined}
    />
  );
}
