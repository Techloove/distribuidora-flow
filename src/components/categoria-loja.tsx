import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";

export function CategoriaLoja({ loja, editar }: { loja: string; editar: boolean }) {
  const { client, user } = useSupabase();
  const qc = useQueryClient();
  const [categoria, setCategoria] = useState("");
  const q = useQuery({
    queryKey: ["loja-categoria", user?.id, loja],
    enabled: !!client && !!user,
    queryFn: async () => {
      const [config, categorias] = await Promise.all([
        client!.from("centros").select("categoria_produtos_id").eq("id", loja).single(),
        client!.from("cad_categorias").select("id,nome,ativo").order("nome"),
      ]);
      if (config.error) throw new Error(config.error.message);
      if (categorias.error) throw new Error(categorias.error.message);
      return {
        atual: String(config.data.categoria_produtos_id ?? ""),
        categorias: (categorias.data ?? []) as { id: string; nome: string; ativo: boolean }[],
      };
    },
  });
  useEffect(() => {
    if (q.data) setCategoria(q.data.atual);
  }, [q.data]);
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("salvar_categoria_loja_246", {
        _loja: loja,
        _categoria: categoria || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(
        "Categoria da loja atualizada. O catálogo acompanha a categoria automaticamente.",
      );
      for (const key of [
        "loja-categoria",
        "loja-catalogo",
        "centros",
        "produtos",
        "vw_promocoes",
        "validar_pedido",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
      <h4 className="font-medium">Categoria dos produtos da loja</h4>
      <p className="text-sm text-muted-foreground">
        Selecione a categoria já utilizada no cadastro dos produtos. Todos os produtos dessa
        categoria, inclusive os novos, entram automaticamente no catálogo desta loja. Não é
        necessário selecioná-los um por um.
      </p>
      {q.isPending ? (
        <p>Carregando categoria…</p>
      ) : q.error ? (
        <p role="alert" className="text-destructive">
          Não foi possível consultar a categoria da loja: {q.error.message}
        </p>
      ) : (
        <>
          <Label htmlFor="categoria-produtos-loja">Categoria Centro Custo / Loja</Label>
          <select
            id="categoria-produtos-loja"
            className="h-10 w-full max-w-lg rounded-md border bg-background px-3"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            disabled={!editar || salvar.isPending}
          >
            <option value="">Todas as categorias (sem filtro)</option>
            {q.data.categorias
              .filter((c) => c.ativo || c.id === q.data.atual)
              .map((c) => (
                <option key={c.id} value={c.id} disabled={!c.ativo}>
                  {c.nome}
                  {!c.ativo ? " (inativa)" : ""}
                </option>
              ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Preços e descontos continuam próprios da loja. Suspensões individuais já feitas são
            preservadas. Mudar a categoria não altera itens ou valores já salvos; pedidos em aberto
            com produtos de outra categoria precisam ser revisados antes da aprovação.
          </p>
          <Button
            variant="outline"
            disabled={!editar || salvar.isPending || categoria === q.data.atual}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? "Salvando…" : "Salvar categoria da loja"}
          </Button>
        </>
      )}
    </div>
  );
}
