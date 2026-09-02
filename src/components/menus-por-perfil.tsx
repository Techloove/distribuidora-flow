import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePapeis } from "@/lib/papeis";
import { MENUS_PADRAO, MODULOS, PAPEIS_TOTAIS } from "@/lib/permissoes";
import { useSupabase, type AppRole } from "@/lib/supabase-provider";

export function MenusPorPerfil() {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const isAdmin = roles.includes("admin");
  const { papeis } = usePapeis();
  const editaveis = papeis.filter((p) => !PAPEIS_TOTAIS.includes(p.codigo as AppRole));
  const [papel, setPapel] = useState<AppRole>("representante");
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const atual = useQuery({
    queryKey: ["role_menus", "admin", papel],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("role_menus").select("path").eq("role", papel);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => String((r as { path: string }).path));
    },
  });

  useEffect(() => {
    if (atual.data) setSelecionados(atual.data);
  }, [atual.data]);

  const salvar = useMutation({
    mutationFn: async () => {
      const del = await client!.from("role_menus").delete().eq("role", papel);
      if (del.error) throw new Error(del.error.message);
      if (selecionados.length) {
        const ins = await client!
          .from("role_menus")
          .insert(selecionados.map((path) => ({ role: papel, path })));
        if (ins.error) throw new Error(ins.error.message);
      }
    },
    onSuccess: () => {
      toast.success("Acesso do perfil atualizado");
      queryClient.invalidateQueries({ queryKey: ["role_menus"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grupos = [...new Set(MODULOS.map((m) => m.grupo))];

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="text-sm font-semibold">Menus liberados por perfil</p>
          <p className="text-xs text-muted-foreground">
            Perfis <strong>{PAPEIS_TOTAIS.join(" e ")}</strong> têm acesso total.
          </p>
        </div>
        <Select value={papel} onValueChange={(v) => setPapel(v as AppRole)}>
          <SelectTrigger className="w-[12rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {editaveis.map((p) => (
              <SelectItem key={p.codigo} value={p.codigo}>
                {p.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdmin ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => salvar.mutate()}
              disabled={salvar.isPending || atual.isLoading}
            >
              {salvar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar acesso
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelecionados(MENUS_PADRAO[papel] ?? [])}
            >
              Usar padrão
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Somente admin pode alterar.</p>
        )}
      </div>

      {atual.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </div>
      ) : atual.isError ? (
        <p className="text-sm text-destructive">
          {(atual.error as Error).message} — rode <code>db/fase26_perfil_acesso.sql</code>.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {grupos.map((grupo) => (
            <div key={grupo} className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {grupo}
              </p>
              {MODULOS.filter((m) => m.grupo === grupo).map((m) => {
                const marcado = selecionados.includes(m.path);
                return (
                  <label key={m.path} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={marcado}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        setSelecionados((prev) =>
                          e.target.checked
                            ? [...new Set([...prev, m.path])]
                            : prev.filter((p) => p !== m.path),
                        )
                      }
                    />
                    {m.label}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
