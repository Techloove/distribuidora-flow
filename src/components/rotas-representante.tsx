import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useSupabase } from "@/lib/supabase-provider";

type Row = Record<string, unknown>;

/** Várias rotas atendidas pelo representante (cadastro unificado). */
export function RotasRepresentante({ pessoaId }: { pessoaId: string | null }) {
  const { client } = useSupabase();
  const qc = useQueryClient();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());

  const dados = useQuery({
    queryKey: ["representante_rotas", pessoaId],
    enabled: !!client && !!pessoaId,
    queryFn: async () => {
      const [rotas, rep] = await Promise.all([
        client!.from("rotas").select("id, nome, ativo").order("nome"),
        client!.from("representantes").select("id").eq("pessoa_id", pessoaId).maybeSingle(),
      ]);
      if (rotas.error) throw new Error(rotas.error.message);
      let vinculadas: string[] = [];
      if (rep.data) {
        const { data, error } = await client!
          .from("representante_rotas")
          .select("rota_id")
          .eq("representante_id", String(rep.data["id"]));
        if (error) throw new Error(error.message);
        vinculadas = (data ?? []).map((r: Row) => String(r["rota_id"]));
      }
      return { rotas: (rotas.data ?? []) as Row[], vinculadas, temRep: !!rep.data };
    },
  });

  useEffect(() => {
    if (dados.data) setMarcadas(new Set(dados.data.vinculadas));
  }, [dados.data]);

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("definir_rotas_representante", {
        _pessoa_id: pessoaId,
        _rotas: [...marcadas],
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Rotas do representante salvas");
      qc.invalidateQueries({ queryKey: ["representante_rotas", pessoaId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Rotas atendidas pelo representante
      </p>
      {!pessoaId ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Salve o cadastro primeiro para escolher as rotas.
        </p>
      ) : dados.isLoading ? (
        <p className="mt-2 text-xs text-muted-foreground">Carregando…</p>
      ) : !dados.data?.temRep ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Salve com "Representante" marcado para liberar as rotas.
        </p>
      ) : (
        <>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {dados.data.rotas.map((r) => {
              const id = String(r["id"]);
              return (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={marcadas.has(id)}
                    onCheckedChange={(v) =>
                      setMarcadas((s) => {
                        const n = new Set(s);
                        if (v) n.add(id);
                        else n.delete(id);
                        return n;
                      })
                    }
                  />
                  {String(r["nome"])}
                </label>
              );
            })}
          </div>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            onClick={() => salvar.mutate()}
            disabled={salvar.isPending}
          >
            Salvar rotas
          </Button>
        </>
      )}
    </div>
  );
}
