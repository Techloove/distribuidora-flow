import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { ErpLayout } from "@/components/erp-layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/auditoria")({
  head: () => ({
    meta: [
      { title: "Auditoria — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Trilha de auditoria das operações críticas: confirmação de pedidos, recebimento de NF e baixas financeiras.",
      },
      { property: "og:title", content: "Auditoria — ERP Distribuidora" },
      { property: "og:description", content: "Histórico das operações sensíveis do ERP." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditoriaPage,
});

type Row = Record<string, unknown>;

function AuditoriaPage() {
  const { client, canManage } = useSupabase();

  const logs = useQuery({
    queryKey: ["auditoria"],
    enabled: !!client && canManage,
    queryFn: async () => {
      const { data, error } = await client!
        .from("auditoria")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  return (
    <ErpLayout
      title="Auditoria"
      description="Registro imutável das ações críticas do sistema. Visível apenas para admin e gestor."
    >
      {!canManage ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Seu perfil não tem permissão para consultar a auditoria.
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          {logs.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : logs.isError ? (
            <p className="p-6 text-sm text-destructive">{(logs.error as Error).message}</p>
          ) : (logs.data ?? []).length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhum evento registrado ainda.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tabela</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Detalhe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data!.map((l) => (
                  <TableRow key={String(l["id"])}>
                    <TableCell>
                      {new Date(String(l["created_at"])).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell>{String(l["tabela"])}</TableCell>
                    <TableCell>{String(l["acao"])}</TableCell>
                    <TableCell className="max-w-[420px] truncate text-xs text-muted-foreground">
                      {l["detalhe"] ? JSON.stringify(l["detalhe"]) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </ErpLayout>
  );
}
