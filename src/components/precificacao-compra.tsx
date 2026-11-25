import { RotateCcw } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/lib/supabase-provider";
import { usePodeAlterarPreco } from "@/lib/papeis";
import { brl } from "@/lib/formatacao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Linha = {
  produto_id: string;
  descricao: string;
  preco_atual: number;
  markup_atual: number;
  custo_atual: number;
  custo_novo: number;
  preco_sugerido: number;
  modo: string | null;
  valor: number | null;
};
type Escolha = { modo: "markup" | "preco"; valor: string };
const PrecificacaoContext = createContext<(produto: string) => ReactNode>(() => null);
export function LinhaPrecificacaoCompra({ produto }: { produto: string }) {
  return useContext(PrecificacaoContext)(produto);
}
export function PrecificacaoCompra({
  compra,
  revisao,
  editavel,
  onPendencia,
  children,
}: {
  compra: string;
  revisao: string;
  editavel: boolean;
  onPendencia: (v: boolean) => void;
  children: ReactNode;
}) {
  const { client, roles } = useSupabase();
  const podePreco = usePodeAlterarPreco();
  const custosVisiveis = !roles.includes("representante") || roles.includes("admin");
  const [rascunhos, setRascunhos] = useState<Record<string, Escolha>>({});
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["precificacao_compra_376", compra, revisao],
    enabled: !!client && custosVisiveis && editavel,
    queryFn: async () => {
      const { data, error } = await client!.rpc("previa_precificacao_compra_376", {
        _compra: compra,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as Linha[];
    },
    retry: false,
  });
  const pendente = Object.keys(rascunhos).length > 0;
  const salvar = useMutation({
    mutationFn: async ({ produto, escolha }: { produto: string; escolha: Escolha | null }) => {
      const valor = escolha ? Number(escolha.valor) : null;
      if (escolha && (escolha.valor.trim() === "" || !Number.isFinite(valor) || valor! < 0))
        throw new Error("Informe um valor válido, zero ou maior");
      const { error } = await client!.rpc("salvar_precificacao_compra_376", {
        _compra: compra,
        _produto: produto,
        _modo: escolha?.modo ?? null,
        _valor: valor,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, { produto }) => {
      setRascunhos((s) => {
        const n = { ...s };
        delete n[produto];
        return n;
      });
      void qc.invalidateQueries({ queryKey: ["precificacao_compra_376", compra] });
      toast.success("Preço planejado para o recebimento");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  useEffect(() => {
    if (!q.isSuccess) return;
    const ids = new Set(q.data.map((l) => l.produto_id));
    setRascunhos((s) => {
      const entries = Object.entries(s).filter(([id]) => ids.has(id));
      return entries.length === Object.keys(s).length ? s : Object.fromEntries(entries);
    });
  }, [q.isSuccess, q.data]);
  useEffect(() => {
    onPendencia(pendente || salvar.isPending);
  }, [pendente, salvar.isPending, onPendencia]);
  useEffect(() => () => onPendencia(false), [onPendencia]);
  const renderProduto = (produto: string) => {
    if (!custosVisiveis || !editavel) return null;
    if (q.isPending) return <p className="text-xs text-muted-foreground">Calculando custos...</p>;
    if (q.isError)
      return (
        <div role="alert" className="flex items-center gap-2 text-xs">
          <span>Não foi possível consultar a precificação. Confira a fase376.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void q.refetch()}>
            Tentar novamente
          </Button>
        </div>
      );
    const l = q.data?.find((l) => l.produto_id === produto);
    if (!l) return null;
    const escolha =
      rascunhos[l.produto_id] ??
      ({
        modo: l.modo === "preco" ? "preco" : "markup",
        valor: String(l.valor ?? l.markup_atual ?? 0),
      } as Escolha);
    const custo = Number(l.custo_novo);
    const venda =
      escolha.modo === "preco" ? Number(escolha.valor) : custo * (1 + Number(escolha.valor) / 100);
    const markup = custo > 0 ? (venda / custo - 1) * 100 : null;
    const alterar = (campo: Partial<Escolha>) =>
      setRascunhos((s) => ({ ...s, [l.produto_id]: { ...escolha, ...campo } }));
    return (
      <div
        aria-label={`Precificação de ${l.descricao}`}
        className="precificacao-linha grid min-w-0 grid-cols-2 items-end gap-2 text-[11px] @min-[600px]:grid-cols-4 @min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))_minmax(95px,1fr)_minmax(80px,.8fr)_minmax(80px,.8fr)_auto]"
      >
        <div className="contents">
          <div>
            <p className="text-xs text-muted-foreground">Custo atual</p>
            <strong>{brl(l.custo_atual)}</strong>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Novo custo médio</p>
            <strong>{brl(l.custo_novo)}</strong>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Venda atual</p>
            <strong>{brl(l.preco_atual)}</strong>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              Sugestão ({Number(l.markup_atual ?? 0).toLocaleString("pt-BR")}%)
            </p>
            <strong>{brl(l.preco_sugerido)}</strong>
          </div>
        </div>
        {editavel && podePreco && (
          <div className="contents">
            <label className="flex min-w-0 flex-col gap-1 text-[11px]">
              <span>Definir por</span>
              <select
                aria-label={`Definir preço de ${l.descricao}`}
                className="h-9 w-full rounded-md border bg-background px-1 text-xs"
                value={escolha.modo}
                disabled={salvar.isPending}
                onChange={(e) =>
                  alterar({
                    modo: e.target.value as Escolha["modo"],
                    valor:
                      e.target.value === "preco"
                        ? String(Math.round(venda * 10000) / 10000)
                        : String(Math.round((markup ?? 0) * 100) / 100),
                  })
                }
              >
                <option value="markup">Markup (%)</option>
                <option value="preco">Preço de venda (R$)</option>
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[11px]">
              <span>{escolha.modo === "markup" ? "Markup (%)" : "Preço de venda (R$)"}</span>
              <Input
                aria-label={`Valor de venda de ${l.descricao}`}
                className="h-9 min-w-0 px-1 text-right text-xs"
                type="number"
                currency={escolha.modo === "preco"}
                min="0"
                step={escolha.modo === "markup" ? "0.01" : "0.0001"}
                value={escolha.valor}
                disabled={salvar.isPending}
                onChange={(e) => alterar({ valor: e.target.value })}
              />
            </label>
            <div className="min-w-0 text-xs">
              <p className="text-xs text-muted-foreground">Venda planejada</p>
              <strong>{Number.isFinite(venda) ? brl(venda) : "—"}</strong>
              <p className="text-xs text-muted-foreground">
                Markup:{" "}
                {markup !== null && Number.isFinite(markup)
                  ? `${markup.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
                  : "—"}
              </p>
            </div>
            <div className="flex min-w-0 items-end gap-1">
              <Button
                type="button"
                size="sm"
                className="h-9 px-2 text-xs"
                disabled={salvar.isPending}
                onClick={() => salvar.mutate({ produto: l.produto_id, escolha })}
              >
                Salvar preço
              </Button>
              {l.modo && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 px-1 text-xs"
                  aria-label={`Usar regra atual de ${l.descricao}`}
                  title="Usar regra atual"
                  disabled={salvar.isPending}
                  onClick={() => salvar.mutate({ produto: l.produto_id, escolha: null })}
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        )}
        <p className="col-span-full text-[11px] text-muted-foreground">
          {rascunhos[l.produto_id]
            ? "Alteração pendente: salve o preço antes de receber a compra."
            : l.modo
              ? "Preço planejado salvo. Aplicação no recebimento."
              : "Sem alteração planejada: mantém a regra atual do produto no recebimento."}
        </p>
      </div>
    );
  };
  return (
    <PrecificacaoContext.Provider value={renderProduto}>{children}</PrecificacaoContext.Provider>
  );
}
