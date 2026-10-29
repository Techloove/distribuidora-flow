import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "./supabase-provider";

/** null preserva o padrão de cada tela até o usuário fazer a primeira escolha. */
export function useColumnPreferences(screen: string, enabled = true) {
  const { client, user } = useSupabase();
  const qc = useQueryClient();
  const key = ["preferencias-colunas", user?.id, screen];
  const saved = useQuery({
    queryKey: key,
    enabled: !!client && !!user && enabled,
    queryFn: async (): Promise<string[] | null> => {
      const { data, error } = await client!
        .from("preferencias_colunas")
        .select("ocultas")
        .eq("usuario_id", user!.id)
        .eq("tela", screen)
        .maybeSingle();
      if (error) throw new Error("Não foi possível carregar suas colunas.");
      return Array.isArray(data?.ocultas)
        ? data.ocultas.filter((v: unknown): v is string => typeof v === "string")
        : null;
    },
  });
  const save = useMutation({
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
    },
    mutationFn: async (ocultas: string[]) => {
      const { error } = await client!
        .from("preferencias_colunas")
        .upsert({ usuario_id: user!.id, tela: screen, ocultas }, { onConflict: "usuario_id,tela" });
      if (error) throw new Error("Não foi possível salvar as colunas. Tente novamente.");
      return ocultas;
    },
    onSuccess: (value) => {
      qc.setQueryData(key, value);
    },
    onError: (error) => toast.error(error.message),
  });
  return { saved, save };
}
