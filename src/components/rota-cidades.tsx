import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, Plus, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSupabase } from "@/lib/supabase-provider";

type Row = Record<string, unknown>;

/** Sequência das cidades atendidas dentro de cada rota. */
export function RotaCidades() {
  const { client } = useSupabase();
  const qc = useQueryClient();
  const [rotaId, setRotaId] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const [sequencia, setSequencia] = useState("");

  const rotas = useQuery({
    queryKey: ["rotas-lista"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("rotas")
        .select("id, nome, sequencia")
        .order("sequencia", { ascending: true })
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const cidades = useQuery({
    queryKey: ["rota_cidades", rotaId],
    enabled: !!client,
    queryFn: async () => {
      let q = client!
        .from("rota_cidades")
        .select("id, rota_id, cidade, uf, sequencia, ativo")
        .order("sequencia");
      if (rotaId) q = q.eq("rota_id", rotaId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!rotaId) throw new Error("Selecione a rota.");
      if (!cidade.trim()) throw new Error("Informe a cidade.");
      const { error } = await client!.from("rota_cidades").insert({
        rota_id: rotaId,
        cidade: cidade.trim(),
        uf: uf.trim() ? uf.trim().toUpperCase() : null,
        sequencia: Number(sequencia) || (cidades.data?.length ?? 0) + 1,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setCidade("");
      setUf("");
      setSequencia("");
      toast.success("Cidade adicionada à rota.");
      void qc.invalidateQueries({ queryKey: ["rota_cidades"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const atualizar = useMutation({
    mutationFn: async (v: { id: string; sequencia: number }) => {
      const { error } = await client!
        .from("rota_cidades")
        .update({ sequencia: v.sequencia })
        .eq("id", v.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["rota_cidades"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.from("rota_cidades").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Cidade removida da rota.");
      void qc.invalidateQueries({ queryKey: ["rota_cidades"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const aplicar = useMutation({
    mutationFn: async (sobrescrever: boolean) => {
      const { data, error } = await client!.rpc("aplicar_rotas_por_cidade", {
        _sobrescrever: sobrescrever,
      });
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    onSuccess: (n) => toast.success(`${n} cliente(s) atualizados pela cidade.`),
    onError: (e: Error) => toast.error(e.message),
  });

  const nomeRota = (id: unknown) =>
    String(rotas.data?.find((r) => r["id"] === id)?.["nome"] ?? "—");

  return (
    <section className="mt-6 rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MapPin className="size-4 text-primary" /> Sequência das cidades da rota
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada cidade pertence a uma rota. Os clientes cadastrados nessa cidade entram
            automaticamente na rota e recebem a sequência de entrega.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => aplicar.mutate(false)}
            disabled={aplicar.isPending}
          >
            <Wand2 className="size-3.5" /> Aplicar aos clientes sem rota
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => aplicar.mutate(true)}
            disabled={aplicar.isPending}
          >
            Reaplicar em todos
          </Button>
        </div>
      </div>

      <div className="grid gap-2 border-b border-border p-4 sm:grid-cols-5">
        <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
          <span>Rota</span>
          <select
            value={rotaId}
            onChange={(e) => setRotaId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            <option value="">Todas as rotas</option>
            {(rotas.data ?? []).map((r) => (
              <option key={String(r["id"])} value={String(r["id"])}>
                {String(r["nome"])}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>Cidade</span>
          <Input
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
            placeholder="Ex.: Iúna"
            className="h-9 bg-background"
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>UF</span>
          <Input
            value={uf}
            maxLength={2}
            onChange={(e) => setUf(e.target.value)}
            placeholder="ES"
            className="h-9 bg-background"
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>Sequência</span>
          <div className="flex gap-2">
            <Input
              type="number"
              value={sequencia}
              onChange={(e) => setSequencia(e.target.value)}
              className="h-9 bg-background"
            />
            <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              <Plus className="size-3.5" />
            </Button>
          </div>
        </label>
      </div>

      {cidades.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </div>
      ) : cidades.isError ? (
        <p className="p-5 text-sm text-destructive">{(cidades.error as Error).message}</p>
      ) : (cidades.data ?? []).length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma cidade cadastrada nesta rota ainda.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Sequência</TableHead>
              <TableHead>Cidade</TableHead>
              <TableHead className="w-16">UF</TableHead>
              <TableHead>Rota</TableHead>
              <TableHead className="w-16 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(cidades.data ?? []).map((c) => (
              <TableRow key={String(c["id"])}>
                <TableCell>
                  <Input
                    type="number"
                    defaultValue={String(c["sequencia"] ?? "")}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (n && n !== Number(c["sequencia"]))
                        atualizar.mutate({ id: String(c["id"]), sequencia: n });
                    }}
                    className="h-8 w-20 bg-background"
                  />
                </TableCell>
                <TableCell>{String(c["cidade"])}</TableCell>
                <TableCell>{String(c["uf"] ?? "—")}</TableCell>
                <TableCell className="text-muted-foreground">{nomeRota(c["rota_id"])}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => excluir.mutate(String(c["id"]))}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
