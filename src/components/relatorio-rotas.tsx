import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { brl } from "@/components/documento-page";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
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

const hojeIso = () => new Date().toISOString().slice(0, 10);
const inicioMes = () => `${new Date().toISOString().slice(0, 7)}-01`;

/** Relatórios de vendas e produtos por rota, cidade e representante. */
export function RelatorioRotas() {
  const { client } = useSupabase();
  const [de, setDe] = useState(inicioMes);
  const [ate, setAte] = useState(hojeIso);
  const [rotaId, setRotaId] = useState("");
  const [repId, setRepId] = useState("");

  const rotas = useQuery({
    queryKey: ["rotas-lista"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("rotas").select("id, nome").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const reps = useQuery({
    queryKey: ["reps-lista"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("representantes").select("id, nome").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const useFaixa = <T,>(view: string, map: (rows: Row[]) => T) =>
    useQuery({
      queryKey: [view, de, ate, rotaId, repId],
      enabled: !!client,
      queryFn: async () => {
        let q = client!.from(view).select("*").gte("data_pedido", de).lte("data_pedido", ate);
        if (rotaId) q = q.eq("rota_id", rotaId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        let rows = (data ?? []) as Row[];
        if (repId)
          rows = rows.filter(
            (r) => !("representante_id" in r) || String(r["representante_id"]) === repId,
          );
        return map(rows);
      },
    });

  const porRota = useFaixa("vw_vendas_rota", (rows) =>
    agrupar(rows, (r) => String(r["rota"] ?? "Sem rota")),
  );
  const porCidade = useFaixa("vw_vendas_rota_cidade", (rows) =>
    agrupar(rows, (r) => `${String(r["cidade"] ?? "—")} (${String(r["rota"] ?? "sem rota")})`),
  );
  const porRepresentante = useFaixa("vw_vendas_representante_rota", (rows) =>
    agrupar(rows, (r) => String(r["representante"] ?? "Sem representante")),
  );
  const produtos = useFaixa("vw_produtos_rota", (rows) =>
    agrupar(
      rows,
      (r) => `${String(r["produto"])} — ${String(r["rota"] ?? "sem rota")}`,
      "quantidade",
    ),
  );

  const opRotas = useMemo(
    () => (rotas.data ?? []).map((r) => ({ value: String(r["id"]), label: String(r["nome"]) })),
    [rotas.data],
  );
  const opReps = useMemo(
    () => (reps.data ?? []).map((r) => ({ value: String(r["id"]), label: String(r["nome"]) })),
    [reps.data],
  );

  return (
    <div className="space-y-6">
      <FilterBar
        onClear={() => {
          setDe(inicioMes());
          setAte(hojeIso());
          setRotaId("");
          setRepId("");
        }}
      >
        <FilterText label="De" type="date" value={de} onChange={setDe} />
        <FilterText label="Até" type="date" value={ate} onChange={setAte} />
        <FilterSelect
          label="Rota"
          value={rotaId}
          onChange={setRotaId}
          options={opRotas}
          allLabel="Todas as rotas"
        />
        <FilterSelect
          label="Representante"
          value={repId}
          onChange={setRepId}
          options={opReps}
          allLabel="Todos"
        />
      </FilterBar>

      <div className="grid gap-6 xl:grid-cols-2">
        <Bloco title="Vendas por rota" query={porRota} />
        <Bloco title="Vendas por cidade da rota" query={porCidade} />
        <Bloco title="Vendas por representante" query={porRepresentante} />
        <Bloco title="Produtos mais vendidos por rota" query={produtos} qtd />
      </div>
    </div>
  );
}

type Agrupado = { chave: string; pedidos: number; quantidade: number; total: number };

function agrupar(rows: Row[], chave: (r: Row) => string, _modo?: "quantidade"): Agrupado[] {
  const mapa = new Map<string, Agrupado>();
  for (const r of rows) {
    const k = chave(r);
    const atual = mapa.get(k) ?? { chave: k, pedidos: 0, quantidade: 0, total: 0 };
    atual.pedidos += Number(r["pedidos"] ?? 0);
    atual.quantidade += Number(r["quantidade"] ?? 0);
    atual.total += Number(r["total"] ?? 0);
    mapa.set(k, atual);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total).slice(0, 20);
}

function Bloco({
  title,
  query,
  qtd,
}: {
  title: string;
  query: { isLoading: boolean; isError: boolean; error: unknown; data?: Agrupado[] | undefined };
  qtd?: boolean;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-5 py-4 text-sm font-semibold text-foreground">
        {title}
      </h2>
      {query.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </div>
      ) : query.isError ? (
        <p className="p-5 text-sm text-destructive">{(query.error as Error).message}</p>
      ) : (query.data ?? []).length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Sem dados no período.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead className="text-right">{qtd ? "Qtd." : "Pedidos"}</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(query.data ?? []).map((r) => (
              <TableRow key={r.chave}>
                <TableCell className="max-w-[18rem] truncate">{r.chave}</TableCell>
                <TableCell className="text-right">{qtd ? r.quantidade : r.pedidos}</TableCell>
                <TableCell className="text-right">{brl(r.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
