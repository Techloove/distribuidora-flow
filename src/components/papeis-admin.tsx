import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePapeis, type Papel } from "@/lib/papeis";
import { useSupabase } from "@/lib/supabase-provider";

export function PapeisAdmin() {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const isAdmin = roles.includes("admin");
  const { papeis, carregando } = usePapeis();

  const [novo, setNovo] = useState("");
  const [editar, setEditar] = useState<Papel | null>(null);
  const [nomeEditado, setNomeEditado] = useState("");
  const [excluir, setExcluir] = useState<Papel | null>(null);

  const recarregar = () => {
    queryClient.invalidateQueries({ queryKey: ["papeis"] });
    queryClient.invalidateQueries({ queryKey: ["user_roles"] });
    queryClient.invalidateQueries({ queryKey: ["role_menus"] });
  };

  const criar = useMutation({
    mutationFn: async (nome: string) => {
      const { error } = await client!.rpc("papel_criar", { _nome: nome });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Perfil criado");
      setNovo("");
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renomear = useMutation({
    mutationFn: async ({ codigo, nome }: { codigo: string; nome: string }) => {
      const { error } = await client!.rpc("papel_renomear", { _codigo: codigo, _nome: nome });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Perfil renomeado");
      setEditar(null);
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (codigo: string) => {
      const { error } = await client!.rpc("papel_excluir", { _codigo: codigo });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Perfil excluído");
      setExcluir(null);
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const definirPreco = useMutation({
    mutationFn: async ({ codigo, pode }: { codigo: string; pode: boolean }) => {
      const { error } = await client!.rpc("papel_definir_preco", {
        _codigo: codigo,
        _pode: pode,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Permissão de preço atualizada");
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <p className="text-sm font-semibold">Perfis de acesso</p>
        <p className="text-xs text-muted-foreground">
          Crie, renomeie ou exclua perfis (ex.: Representante, Financeiro). Perfis do sistema não
          podem ser excluídos.
        </p>
      </div>

      {isAdmin ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (novo.trim()) criar.mutate(novo);
          }}
        >
          <Input
            className="w-full sm:w-64"
            placeholder="Nome do novo perfil"
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={criar.isPending || !novo.trim()}>
            {criar.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Incluir perfil
          </Button>
        </form>
      ) : null}

      {carregando ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {papeis.map((p) => (
            <li key={p.codigo} className="flex flex-wrap items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.nome}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {p.codigo}
                  {p.sistema ? " · perfil do sistema" : ""}
                </p>
                <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={p.pode_alterar_preco !== false}
                    disabled={!isAdmin || definirPreco.isPending}
                    onChange={(e) =>
                      definirPreco.mutate({ codigo: p.codigo, pode: e.target.checked })
                    }
                  />
                  Pode alterar o preço unitário dos itens
                </label>
              </div>
              {isAdmin ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditar(p);
                      setNomeEditado(p.nome);
                    }}
                  >
                    <Pencil className="size-4" />
                    Renomear
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={p.sistema}
                    onClick={() => setExcluir(p)}
                  >
                    <Trash2 className="size-4" />
                    Excluir
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!editar} onOpenChange={(o) => !o && setEditar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear perfil</DialogTitle>
          </DialogHeader>
          <Input value={nomeEditado} onChange={(e) => setNomeEditado(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditar(null)}>
              Cancelar
            </Button>
            <Button
              disabled={renomear.isPending || !nomeEditado.trim()}
              onClick={() =>
                editar && renomear.mutate({ codigo: editar.codigo, nome: nomeEditado })
              }
            >
              {renomear.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!excluir} onOpenChange={(o) => !o && setExcluir(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir perfil</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            O perfil <strong>{excluir?.nome}</strong> será removido de todos os usuários e dos menus
            liberados. Deseja continuar?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcluir(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={remover.isPending}
              onClick={() => excluir && remover.mutate(excluir.codigo)}
            >
              {remover.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
