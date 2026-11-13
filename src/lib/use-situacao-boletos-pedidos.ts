import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "./supabase-provider";
import { lerPaginas } from "./paginacao";
import {
  operacaoBoletosDocumento,
  type TituloBoleto,
  type BoletoDocumento,
} from "./boletos-documento";

/** Leitura em lote, com RLS, apenas dos pedidos exibidos. Não consulta APIs bancárias. */
export function useSituacaoBoletosPedidos(pedidos: string[]) {
  const { client, user, roles } = useSupabase();
  const ids = [...new Set(pedidos)].sort();
  return useQuery({
    queryKey: ["situacao-boletos-pedidos", user?.id, ids],
    enabled:
      !!client &&
      !!user &&
      ids.length > 0 &&
      roles.some((r) => ["admin", "gestor", "financeiro"].includes(r)),
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const titulos: TituloBoleto[] = [];
      const boletos: (BoletoDocumento & { pedido_id: string })[] = [];
      for (let p = 0; p < ids.length; p += 50) {
        const lote = ids.slice(p, p + 50);
        const [t, b] = await Promise.all([
          lerPaginas<TituloBoleto>((inicio, fim) =>
            client!
              .from("contas_receber")
              .select(
                "id,pedido_id,centro_id,parcela,vencimento,valor,status,juros,multa,acrescimo,desconto,valor_pago",
              )
              .in("pedido_id", lote)
              .order("id")
              .range(inicio, fim),
          ),
          lerPaginas<BoletoDocumento & { pedido_id: string }>((inicio, fim) =>
            client!
              .from("boletos")
              .select(
                "id,pedido_id,valor,conta_receber_id,status,banco,canal,linha_digitavel,ambiente,created_at",
              )
              .in("pedido_id", lote)
              .order("id")
              .range(inicio, fim),
          ),
        ]);
        titulos.push(...t);
        boletos.push(...b);
      }
      return Object.fromEntries(
        ids.map((id) => [
          id,
          operacaoBoletosDocumento(
            titulos.filter((t) => t.pedido_id === id),
            boletos.filter((b) => b.pedido_id === id),
          ),
        ]),
      );
    },
  });
}
