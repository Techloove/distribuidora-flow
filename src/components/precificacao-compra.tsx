import { useEffect, useState } from "react";
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
export function PrecificacaoCompra({
  compra,
  revisao,
  editavel,
  onPendencia,
}: {
  compra: string;
  revisao: string;
  editavel: boolean;
  onPendencia: (v: boolean) => void;
}) {
  const { client, roles } = useSupabase();
  const podePreco = usePodeAlterarPreco();
  const custosVisiveis = !roles.includes("representante") || roles.includes("admin");
  const [rascunhos, setRascunhos] = useState<Record<string, Escolha>>({});
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["precificacao_compra_376", compra, revisao],
    enabled: !!client && custosVisiveis,
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
  if (!custosVisiveis) return null;
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h3 className="font-semibold">Custo médio e preço de venda</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Prévia por produto com estoque atual, IPI, frete e ajustes gerais da compra. Os preços
          planejados serão gravados nos produtos ao receber a compra. A prévia pode mudar até o
          recebimento.
        </p>
      </div>
      {q.isPending ? (
        <p className="text-sm">Calculando custos...</p>
      ) : q.isError ? (
        <div role="alert" className="text-sm">
          <p>Não foi possível consultar a precificação. Confira a instalação da fase376.</p>
          <Button type="button" variant="outline" onClick={() => void q.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {q.data?.map((l) => {
            const escolha =
              rascunhos[l.produto_id] ??
              ({
                modo: l.modo === "preco" ? "preco" : "markup",
                valor: String(l.valor ?? l.markup_atual ?? 0),
              } as Escolha);
            const custo = Number(l.custo_novo);
            const venda =
              escolha.modo === "preco"
                ? Number(escolha.valor)
                : custo * (1 + Number(escolha.valor) / 100);
            const markup = custo > 0 ? (venda / custo - 1) * 100 : null;
            const alterar = (campo: Partial<Escolha>) =>
              setRascunhos((s) => ({ ...s, [l.produto_id]: { ...escolha, ...campo } }));
            return (
              <div key={l.produto_id} className="space-y-3 rounded-lg border p-3">
                <p className="font-medium">{l.descricao}</p>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Custo médio atual</p>
                    <strong>{brl(l.custo_atual)}</strong>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Novo custo médio previsto</p>
                    <strong>{brl(l.custo_novo)}</strong>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Venda atual (informativo)</p>
                    <strong>{brl(l.preco_atual)}</strong>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Sugestão pelo markup atual (
                      {Number(l.markup_atual ?? 0).toLocaleString("pt-BR")}%)
                    </p>
                    <strong>{brl(l.preco_sugerido)}</strong>
                  </div>
                </div>
                {editavel && podePreco && (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="space-y-1 text-sm">
                      <span>Definir por</span>
                      <select
                        aria-label={`Definir preço de ${l.descricao}`}
                        className="h-10 w-full rounded-md border bg-background px-2"
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
                    <label className="space-y-1 text-sm">
                      <span>
                        {escolha.modo === "markup" ? "Markup (%)" : "Preço de venda (R$)"}
                      </span>
                      <Input
                        aria-label={`Valor de venda de ${l.descricao}`}
                        type="number"
                        currency={escolha.modo === "preco"}
                        min="0"
                        step={escolha.modo === "markup" ? "0.01" : "0.0001"}
                        value={escolha.valor}
                        disabled={salvar.isPending}
                        onChange={(e) => alterar({ valor: e.target.value })}
                      />
                    </label>
                    <div className="text-sm">
                      <p className="text-xs text-muted-foreground">Venda planejada</p>
                      <strong>{Number.isFinite(venda) ? brl(venda) : "—"}</strong>
                      <p className="text-xs text-muted-foreground">
                        Markup:{" "}
                        {markup !== null && Number.isFinite(markup)
                          ? `${markup.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
                          : "—"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <Button
                        type="button"
                        disabled={salvar.isPending}
                        onClick={() => salvar.mutate({ produto: l.produto_id, escolha })}
                      >
                        Salvar preço
                      </Button>
                      {l.modo && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={salvar.isPending}
                          onClick={() => salvar.mutate({ produto: l.produto_id, escolha: null })}
                        >
                          Usar regra atual
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {rascunhos[l.produto_id]
                    ? "Alteração pendente: salve o preço antes de receber a compra."
                    : l.modo
                      ? "Preço planejado salvo. Aplicação no recebimento."
                      : "Sem alteração planejada: mantém a regra atual do produto no recebimento."}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
