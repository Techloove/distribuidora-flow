import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Printer } from "lucide-react";
import { useMemo, useState } from "react";

import { brl } from "@/components/documento-page";
import { ErpLayout } from "@/components/erp-layout";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCentro } from "@/lib/centro-store";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/clientes-inativos")({
  head: () => ({
    meta: [
      { title: "Clientes inativos — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Clientes sem comprar há 15, 30, 45, 60, 90 ou 120 dias, com ticket médio e potencial de recuperação.",
      },
      { property: "og:title", content: "Clientes inativos — ERP Distribuidora" },
      { property: "og:description", content: "Recuperação da carteira de clientes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InativosPage,
});

type Row = Record<string, unknown>;
const faixas = [15, 30, 45, 60, 90, 120];

function InativosPage() {
  const { client, user, roles, loading } = useSupabase();
  const carteiraRestrita = roles.includes("representante") && !roles.includes("admin");
  const { centro } = useCentro();
  const [dias, setDias] = useState(60);
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const lista = useQuery({
    queryKey: ["vw_clientes_inativos", user?.id, carteiraRestrita],
    enabled: !!client && !!user && !loading,
    queryFn: async () => {
      let representante: string | null = null;
      if (carteiraRestrita) {
        const vinculo = await client!.rpc("meu_representante_id");
        if (vinculo.error) throw new Error(vinculo.error.message);
        representante = vinculo.data as string | null;
        if (!representante) return [] as Row[];
      }
      let consulta = client!
        .from("vw_clientes_inativos")
        .select("*");
      if (carteiraRestrita) consulta = consulta.eq("representante_id", representante!);
      const { data, error } = await consulta.order("dias_sem_comprar", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const opcoes = useMemo(() => {
    const list = lista.data ?? [];
    const uniq = (key: string) =>
      [...new Set(list.map((r) => String(r[key] ?? "")).filter(Boolean))]
        .sort()
        .map((v) => ({ value: v, label: v }));
    return {
      representantes: uniq("representante"),
      centros: uniq("centro"),
    };
  }, [lista.data]);

  const rows = useMemo(() => {
    let list = (lista.data ?? []).filter((r) => Number(r["dias_sem_comprar"] ?? 0) >= dias);
    if (centro) list = list.filter((r) => !r["centro_id"] || r["centro_id"] === centro);
    const termo = (filtros["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter((r) => String(r["razao_social"] ?? "").toLowerCase().includes(termo));
    }
    if (filtros["diasMin"]) {
      list = list.filter(
        (r) => Number(r["dias_sem_comprar"] ?? 0) >= Number(filtros["diasMin"]),
      );
    }
    if (filtros["representante"]) {
      list = list.filter(
        (r) => String(r["representante"] ?? "") === filtros["representante"],
      );
    }
    if (filtros["centro"]) {
      list = list.filter((r) => String(r["centro"] ?? "") === filtros["centro"]);
    }
    return list;
  }, [lista.data, dias, centro, filtros]);

  const potencial = rows.reduce((s, r) => s + Number(r["ticket_medio"] ?? 0), 0);

  return (
    <ErpLayout
      title="Clientes sem comprar"
      description="Ferramenta comercial para recuperar clientes parados: filtre pelo tempo sem pedido e trabalhe a carteira."
      actions={
        <div className="flex flex-wrap gap-2">
          {faixas.map((f) => (
            <Button key={f} variant={dias === f ? "default" : "outline"} onClick={() => setDias(f)}>
              {f} dias
            </Button>
          ))}
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" /> Imprimir
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <FilterBar onClear={() => setFiltros({})}>
          <FilterText
            label="Buscar cliente"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
            placeholder="Razão social..."
          />
          <FilterText
            label="Dias sem comprar (mínimo)"
            type="number"
            value={filtros["diasMin"] ?? ""}
            onChange={(v) => setF("diasMin", v)}
          />
          {!carteiraRestrita && <FilterSelect
            label="Representante"
            value={filtros["representante"] ?? ""}
            onChange={(v) => setF("representante", v)}
            options={opcoes.representantes}
          />}
          <FilterSelect
            label="Centro de custo"
            value={filtros["centro"] ?? ""}
            onChange={(v) => setF("centro", v)}
            options={opcoes.centros}
          />
        </FilterBar>

        <div className="mb-4 rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            {rows.length} cliente(s) sem pedido há mais de {dias} dias
          </p>
          <p className="mt-1 text-2xl font-semibold">
            Potencial de recuperação: {brl(potencial)}
          </p>
        </div>

        <div className="print-area rounded-lg border border-border bg-card">
          {lista.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : lista.isError ? (
            <p className="p-5 text-sm text-destructive">{(lista.error as Error).message}</p>
          ) : rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">
              Nenhum cliente nessa faixa.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Representante</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead>Último pedido</TableHead>
                  <TableHead className="text-right">Dias sem comprar</TableHead>
                  <TableHead className="text-right">Ticket médio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={String(r["cliente_id"])}>
                    <TableCell className="max-w-[16rem] truncate">
                      {String(r["razao_social"])}
                    </TableCell>
                    <TableCell>{String(r["representante"] ?? "—")}</TableCell>
                    <TableCell>{String(r["cidade"] ?? "—")}</TableCell>
                    <TableCell>{String(r["ultimo_pedido"] ?? "nunca comprou")}</TableCell>
                    <TableCell className="text-right">
                      {Number(r["dias_sem_comprar"]) >= 9999 ? "—" : String(r["dias_sem_comprar"])}
                    </TableCell>
                    <TableCell className="text-right">{brl(r["ticket_medio"])}</TableCell>
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
