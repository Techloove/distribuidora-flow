import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";

export type Acompanhamento = {
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
      const { data, error } = await client!.rpc("acompanhar_pedido_235", { _pedido: pedidoId });
      if (error)
        throw new Error(
          /schema cache|does not exist|Could not find/.test(error.message)
            ? "Aplique a fase235 no Supabase para ativar o acompanhamento dos pedidos."
            : error.message,
        );
      return data as Acompanhamento;
    },
  });
  return { ...q, pode };
}
