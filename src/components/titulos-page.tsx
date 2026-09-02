import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export type TitulosConfig = {
  table: "contas_receber" | "contas_pagar";
  partnerTable: "clientes" | "fornecedores";
  partnerKey: "cliente_id" | "fornecedor_id";
  partnerLabel: string;
  rpc: "baixar_receber" | "baixar_pagar";
  baixaLabel: string;
};

const statuses = ["todos", "aberto", "parcial", "pago", "cancelado"] as const;

export function TitulosPage({ config }: { config: TitulosConfig }) {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof statuses)[number]>("aberto");
  const [target, setTarget] = useState<Row | null>(null);
  const [valor, setValor] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));

  const canFinance =
    roles.includes("admin") || roles.includes("gestor") || roles.includes("financeiro");

  const titulos = useQuery({
    queryKey: [config.table],
    enabled: !!client,
    queryFn: async () => {
      const { data: rows, error } = await client!
        .from(config.table)
        .select("*")
        .order("vencimento");
      if (error) throw new Error(error.message);
      return (rows ?? []) as Row[];
    },
  });

  const partners = useQuery({
    queryKey: [config.partnerTable, "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data: rows, error } = await client!
        .from(config.partnerTable)
        .select("id, razao_social")
        .order("razao_social");
      if (error) throw new Error(error.message);
      return (rows ?? []) as Row[];
    },
  });

  const rows = useMemo(() => {
    const list = titulos.data ?? [];
    return status === "todos" ? list : list.filter((r) => r["status"] === status);
  }, [titulos.data, status]);

  const totals = useMemo(() => {
    const abertos = (titulos.data ?? []).filter((r) => r["status"] !== "pago" && r["status"] !== "cancelado");
    const hoje = new Date().toISOString().slice(0, 10);
    return {
      aberto: abertos.reduce((s, r) => s + Number(r["valor"] ?? 0) - Number(r["valor_pago"] ?? 0), 0),
      vencido: abertos
        .filter((r) => String(r["vencimento"]) < hoje)
        .reduce((s, r) => s + Number(r["valor"] ?? 0) - Number(r["valor_pago"] ?? 0), 0),
      pago: (titulos.data ?? []).reduce((s, r) => s + Number(r["valor_pago"] ?? 0), 0),
    };
  }, [titulos.data]);

  const baixar = useMutation({
    mutationFn: async () => {
      const v = Number(valor || 0);
      if (v <= 0) throw new Error("Informe o valor da baixa");
      const { error } = await client!.rpc(config.rpc, {
        _id: target!["id"],
        _valor: v,
        _data: data,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Baixa registrada");
      setTarget(null);
      setValor("");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const partnerName = (id: unknown) =>
    String(partners.data?.find((p) => p["id"] === id)?.["razao_social"] ?? "—");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card label="Em aberto" value={brl(totals.aberto)} />
        <Card label="Vencido" value={brl(totals.vencido)} tone />
        <Card label={config.table === "contas_receber" ? "Recebido" : "Pago"} value={brl(totals.pago)} />
      </div>

      <div className="flex flex-wrap gap-2">
        {statuses.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "default" : "outline"}
            onClick={() => setStatus(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card">
        {titulos.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </div>
        ) : titulos.isError ? (
          <div className="p-6 text-sm text-destructive">
            {(titulos.error as Error).message}
            <p className="mt-2 text-xs text-muted-foreground">
              Rode <code>db/fase2_vendas_estoque_financeiro.sql</code> no SQL Editor do Supabase.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Nenhum título neste filtro.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>{config.partnerLabel}</TableHead>
                <TableHead>Parc.</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={String(r["id"])}>
                  <TableCell>{String(r["documento"] ?? "—")}</TableCell>
                  <TableCell>{partnerName(r[config.partnerKey])}</TableCell>
                  <TableCell>{String(r["parcela"])}</TableCell>
                  <TableCell>{String(r["vencimento"])}</TableCell>
                  <TableCell className="text-right">{brl(r["valor"])}</TableCell>
                  <TableCell className="text-right">{brl(r["valor_pago"])}</TableCell>
                  <TableCell>{String(r["status"])}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canFinance || r["status"] === "pago" || r["status"] === "cancelado"}
                      onClick={() => {
                        setTarget(r);
                        setValor(String(Number(r["valor"] ?? 0) - Number(r["valor_pago"] ?? 0)));
                      }}
                    >
                      {config.baixaLabel}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {!canFinance ? (
        <p className="text-xs text-muted-foreground">
          Somente perfis <strong>financeiro</strong>, <strong>gestor</strong> ou{" "}
          <strong>admin</strong> podem baixar títulos.
        </p>
      ) : null}

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{config.baixaLabel} título</DialogTitle>
            <DialogDescription>
              Saldo atual{" "}
              {brl(Number(target?.["valor"] ?? 0) - Number(target?.["valor_pago"] ?? 0))}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Valor</Label>
              <Input
                type="number"
                step="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={() => baixar.mutate()} disabled={baixar.isPending}>
              {baixar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <article className="rounded-lg border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tracking-tight ${
          tone ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </article>
  );
}
