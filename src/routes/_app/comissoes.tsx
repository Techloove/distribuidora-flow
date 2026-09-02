import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/comissoes")({
  head: () => ({
    meta: [
      { title: "Comissões — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Comissões previstas por representante geradas na confirmação dos pedidos, com liberação e baixa de pagamento.",
      },
      { property: "og:title", content: "Comissões — ERP Distribuidora" },
      { property: "og:description", content: "Comissões flexíveis por pedido e representante." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ComissoesPage,
});

type Row = Record<string, unknown>;

function ComissoesPage() {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const canFinance =
    roles.includes("admin") || roles.includes("gestor") || roles.includes("financeiro");

  const comissoes = useQuery({
    queryKey: ["comissoes"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("comissoes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const representantes = useQuery({
    queryKey: ["representantes", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("representantes").select("id, nome").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await client!.from("comissoes").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Comissão atualizada");
      queryClient.invalidateQueries({ queryKey: ["comissoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const repName = (id: unknown) =>
    String(representantes.data?.find((r) => r["id"] === id)?.["nome"] ?? "—");

  const total = (comissoes.data ?? [])
    .filter((c) => c["status"] !== "cancelada")
    .reduce((s, c) => s + Number(c["valor"] ?? 0), 0);

  return (
    <ErpLayout
      title="Comissões"
      description="Geradas automaticamente ao confirmar pedidos, usando o percentual informado no documento."
    >
      <div className="space-y-4">
        <article className="rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">Total de comissões ativas</p>
          <p className="mt-2 text-2xl font-semibold">{brl(total)}</p>
        </article>

        <div className="rounded-lg border border-border bg-card">
          {comissoes.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : comissoes.isError ? (
            <div className="p-6 text-sm text-destructive">
              {(comissoes.error as Error).message}
              <p className="mt-2 text-xs text-muted-foreground">
                Rode <code>db/fase2_vendas_estoque_financeiro.sql</code> no SQL Editor do Supabase.
              </p>
            </div>
          ) : (comissoes.data ?? []).length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma comissão gerada ainda.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Representante</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comissoes.data!.map((c) => (
                  <TableRow key={String(c["id"])}>
                    <TableCell>{repName(c["representante_id"])}</TableCell>
                    <TableCell className="text-right">{brl(c["base_calculo"])}</TableCell>
                    <TableCell className="text-right">{String(c["percentual"])}</TableCell>
                    <TableCell className="text-right">{brl(c["valor"])}</TableCell>
                    <TableCell>{String(c["status"])}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canFinance || c["status"] !== "prevista"}
                          onClick={() =>
                            setStatus.mutate({ id: String(c["id"]), status: "liberada" })
                          }
                        >
                          Liberar
                        </Button>
                        <Button
                          size="sm"
                          disabled={!canFinance || c["status"] === "paga" || c["status"] === "cancelada"}
                          onClick={() => setStatus.mutate({ id: String(c["id"]), status: "paga" })}
                        >
                          Pagar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </ErpLayout>
  );
}
