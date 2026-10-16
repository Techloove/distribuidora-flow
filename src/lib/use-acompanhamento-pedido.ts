import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";

export type Acompanhamento = {
  tipo_documento?: string;
  orcamento_situacao?: string | null;
  orcamento_validade?: string | null;
  orcamento_data?: string | null;
  orcamento_aceito_em?: string | null;
  [key: string]: unknown;
  pedido_id: string;
  numero: number;
  status: string;
  data_pedido: string;
  data_saida: string | null;
  previsao_entrega: string | null;
  data_entrega: string | null;
  recebedor: string | null;
  carga_numero: number | null;
  ultima_visita: string | null;
  recebedor_ultima_visita: string | null;
  possui_entrega_parcial: boolean;
};
export function useAcompanhamentoPedido(pedidoId: string) {
  const { client, user, roles } = useSupabase(),
    perm = usePermissoesRotinas();
  const pode = perm.pode("pedidos_acompanhar");
  const q = useQuery({
    queryKey: ["acompanhamento_pedido_235", user?.id, roles.slice().sort().join(","), pedidoId],
    enabled: !!client && !!user && !!pedidoId && pode,
    refetchInterval: 30_000,
    queryFn: async () => {
      let { data, error } = await client!.rpc("acompanhar_pedido_236", { _pedido: pedidoId });
      // Mantém o acompanhamento anterior durante a aplicação da migração aditiva.
      if (error?.code === "PGRST202" && error.message.includes("acompanhar_pedido_236")) {
        const anterior = await client!.rpc("acompanhar_pedido_235", { _pedido: pedidoId });
        data = anterior.data;
        error = anterior.error;
      }
      if (error)
        throw new Error(
          /schema cache|does not exist|Could not find/.test(error.message)
            ? "Aplique a fase236 no Supabase para ativar o acompanhamento dos pedidos."
            : error.message,
        );
      return data as Acompanhamento;
    },
  });
  return { ...q, pode };
}
