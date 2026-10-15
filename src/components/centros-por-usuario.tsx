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
import { useSupabase } from "@/lib/supabase-provider";

type Profile = { id: string; nome: string | null; email: string | null; todos_centros: boolean };
type Centro = { id: string; nome: string };

export function CentrosPorUsuario() {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const isAdmin = roles.includes("admin");
  const [userId, setUserId] = useState("");
  const [todos, setTodos] = useState(true);
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const profiles = useQuery({
    queryKey: ["profiles", "centros"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("profiles")
        .select("id, nome, email, todos_centros")
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Profile[];
    },
  });

  const centros = useQuery({
    queryKey: ["centros", "acesso"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("centros").select("id, nome").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Centro[];
    },
  });

  const vinculos = useQuery({
    queryKey: ["usuario_centros", userId],
    enabled: !!client && !!userId,
    queryFn: async () => {
      const { data, error } = await client!
        .from("usuario_centros")
        .select("centro_id")
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => String((r as { centro_id: string }).centro_id));
    },
  });

  useEffect(() => {
    if (!userId) return;
    const p = profiles.data?.find((x) => x.id === userId);
    setTodos(p?.todos_centros ?? true);
  }, [userId, profiles.data]);

  useEffect(() => {
    if (vinculos.data) setSelecionados(vinculos.data);
  }, [vinculos.data]);

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("definir_centros_usuario", {
        _user_id: userId,
        _todos: todos,
        _centros: todos ? [] : selecionados,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Acesso por centro atualizado");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["usuario_centros"] });
      queryClient.invalidateQueries({ queryKey: ["centros"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (id: string) =>
    setSelecionados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">Acesso por centro de custo</h3>
        <p className="text-xs text-muted-foreground">
          Escolha se o usuário vê todos os centros ou apenas os centros selecionados. Usuários
          restritos consultam os pedidos e o financeiro dos centros liberados. Produtos e saldo de
          estoque são compartilhados entre as lojas.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger className="w-full sm:w-[20rem]">
            <SelectValue placeholder="Selecione o usuário" />
          </SelectTrigger>
          <SelectContent>
            {(profiles.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nome || p.email || p.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {userId ? (
          <Select
            value={todos ? "todos" : "restrito"}
            onValueChange={(v) => setTodos(v === "todos")}
          >
            <SelectTrigger className="w-full sm:w-[16rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os centros</SelectItem>
              <SelectItem value="restrito">Somente centros escolhidos</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {userId && !todos ? (
        vinculos.isLoading || centros.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(centros.data ?? []).map((c) => {
              const active = selecionados.includes(c.id);
              return (
                <Button
                  key={c.id}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  disabled={!isAdmin}
                  onClick={() => toggle(c.id)}
                >
                  {c.nome}
                </Button>
              );
            })}
          </div>
        )
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!isAdmin || !userId || salvar.isPending || (!todos && !selecionados.length)}
          onClick={() => salvar.mutate()}
        >
          {salvar.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Salvar acesso
        </Button>
        {!isAdmin ? (
          <span className="text-xs text-muted-foreground">
            Somente <strong>admin</strong> pode alterar.
          </span>
        ) : null}
      </div>
    </div>
  );
}
