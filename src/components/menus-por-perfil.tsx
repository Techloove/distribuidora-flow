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
import { MENUS_PADRAO, MODULOS, normalizarModulo, PAPEIS_TOTAIS } from "@/lib/permissoes";
import { useSupabase, type AppRole } from "@/lib/supabase-provider";

export function MenusPorPerfil() {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const isAdmin = roles.includes("admin");
  const { papeis } = usePapeis();
  const editaveis = papeis.filter((p) => !PAPEIS_TOTAIS.includes(p.codigo as AppRole));
  const [papel, setPapel] = useState<AppRole>("representante");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [acoes, setAcoes] = useState<string[]>([]);
  const catalogo = useQuery({
    queryKey: ["permissoes", "catalogo-rotinas"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("permissoes")
        .select("codigo,nome,grupo,modulo")
        .not("modulo", "is", null)
        .order("ordem");
      if (error)
        throw new Error("Aplique a fase211 no Supabase para configurar as ações das rotinas.");
      return (data ?? []) as { codigo: string; nome: string; grupo: string; modulo: string }[];
    },
  });

  const atual = useQuery({
    queryKey: ["role_menus", "admin", papel],
    enabled: !!client,
    queryFn: async () => {
      const [menus, permissoes] = await Promise.all([
        client!.from("role_menus").select("path").eq("role", papel),
        client!.from("role_permissoes").select("permissao").eq("role", papel),
      ]);
      if (menus.error || permissoes.error)
        throw new Error("Não foi possível carregar os acessos deste perfil.");
      return {
        menus: [...new Set((menus.data ?? []).map((r) => normalizarModulo(r.path)))],
        acoes: (permissoes.data ?? []).map((r) => String(r.permissao)),
      };
    },
  });

  useEffect(() => {
    if (atual.data) {
      setSelecionados(atual.data.menus);
      setAcoes(atual.data.acoes);
    }
  }, [atual.data]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!isAdmin || atual.isPending || atual.isError || catalogo.isPending || catalogo.isError)
        throw new Error("Aguarde o carregamento válido dos acessos antes de salvar.");
      const { error } = await client!.rpc("admin_salvar_acesso", {
        _role: papel,
        _menus: selecionados,
        _permissoes: acoes,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Acesso do perfil atualizado");
      queryClient.invalidateQueries({ queryKey: ["role_menus"] });
      queryClient.invalidateQueries({ queryKey: ["minhas_permissoes"] });
      queryClient.invalidateQueries({ queryKey: ["role_permissoes"] });
      queryClient.invalidateQueries({ queryKey: ["pendencias"] });
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
        <Select
          disabled={salvar.isPending}
          value={papel}
          onValueChange={(v) => {
            setSelecionados([]);
            setAcoes([]);
            setPapel(v as AppRole);
          }}
        >
          <SelectTrigger aria-label="Perfil para configurar acesso" className="w-[12rem]">
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
              disabled={
                salvar.isPending ||
                atual.isPending ||
                atual.isError ||
                catalogo.isPending ||
                catalogo.isError
              }
            >
              {salvar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar acesso
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={salvar.isPending || atual.isPending || atual.isError}
              onClick={() => setSelecionados(MENUS_PADRAO[papel] ?? [])}
            >
              Menus padrão
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
        <p className="text-sm text-destructive">{(atual.error as Error).message}</p>
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
                      disabled={!isAdmin || salvar.isPending}
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
      <div className="border-t pt-4 space-y-3">
        <p className="text-sm font-semibold">Ações das novas rotinas</p>
        <p className="text-xs text-muted-foreground">
          Marque o menu e a ação para liberar a rotina. Desmarcar impede a operação também no
          servidor. Os papéis operacionais, centros e carteiras continuam sendo exigidos: esta
          seleção não transforma um representante em financeiro ou gestor. Quando há mais de um
          perfil no usuário, os acessos concedidos são somados. Administrador e gestor mantêm acesso
          total; auditoria continua restrita à gestão.
        </p>
        {catalogo.isPending ? (
          <p className="text-sm">Carregando ações…</p>
        ) : catalogo.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {catalogo.error.message}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...new Set(catalogo.data.map((p) => p.grupo))].map((grupo) => (
              <div className="space-y-2" key={grupo}>
                <p className="text-xs font-semibold">{grupo}</p>
                {catalogo.data
                  .filter((p) => p.grupo === grupo)
                  .map((p) => (
                    <label key={p.codigo} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-primary"
                        checked={acoes.includes(p.codigo)}
                        disabled={!isAdmin || salvar.isPending || atual.isPending || atual.isError}
                        onChange={(e) =>
                          setAcoes((s) =>
                            e.target.checked
                              ? [...new Set([...s, p.codigo])]
                              : s.filter((x) => x !== p.codigo),
                          )
                        }
                      />
                      <span>
                        {p.nome}
                        <small className="block text-muted-foreground">
                          {selecionados.includes(p.modulo) ? "Menu liberado" : "Menu bloqueado"}
                        </small>
                      </span>
                    </label>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
