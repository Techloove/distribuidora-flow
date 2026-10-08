import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import type { Registro } from "@/lib/rotinas-distribuidora";

export function useRotinaRpc(chaves: string[]) {
  const { client } = useSupabase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ nome, args }: { nome: string; args: Registro }) => {
      if (!client) throw new Error("Conexão indisponível");
      const { data, error } = await client.rpc(nome, args);
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      chaves.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
      void qc.invalidateQueries({ queryKey: ["pendencias"] });
      toast.success("Registro salvo");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
