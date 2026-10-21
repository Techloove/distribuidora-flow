import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { lerPaginas } from "@/lib/paginacao";
import {
  chaveGrupo,
  chaveLocal,
  tarifaComum,
  type CidadeFrete,
  type TarifaFrete,
} from "@/lib/frete-volume-grade";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Produto = {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  grupo: string;
  categoria: string;
};
type Edicao = { valor: string; ativo: boolean };
type Modo = "produto" | "grupo" | "categoria";
export function FreteVolumeLoja({
  loja,
  cidadeInicial = "",
}: {
  loja: string;
  cidadeInicial?: string;
}) {
  const { client, user, canManage } = useSupabase();
  const permissoes = usePermissoesRotinas();
  const pode = canManage && permissoes.pode("lojas_frete_volume_configurar");
  const qc = useQueryClient();
  const [modo, setModo] = useState<Modo>("produto");
  const [alvo, setAlvo] = useState("");
  const [busca, setBusca] = useState("");
  const [unidade, setUnidade] = useState("");
  const [excluidos, setExcluidos] = useState<string[]>([]);
  const [filtroCidade, setFiltroCidade] = useState(cidadeInicial);
  const [edicoes, setEdicoes] = useState<Record<string, Edicao>>({});
  const cidades = useQuery({
    queryKey: ["cidades-frete-volume", loja, user?.id],
    enabled: !!client && pode,
    queryFn: () =>
      lerPaginas<CidadeFrete>(async (inicio, fim) => {
        const { data, error } = await client!
          .rpc("cidades_frete_volume_250", { _loja: loja })
          .range(inicio, fim);
        return { data: data as CidadeFrete[] | null, error };
      }),
  });
  const produtos = useQuery({
    queryKey: ["loja-catalogo", "frete-grade", loja, user?.id],
    enabled: !!client && pode,
    queryFn: () =>
      lerPaginas<Produto>(async (inicio, fim) => {
        const { data, error } = await client!
          .rpc("produtos_frete_volume_251", { _loja: loja })
          .range(inicio, fim);
        return { data: data as Produto[] | null, error };
      }),
  });
  const tarifas = useQuery({
    queryKey: ["tarifas-frete-volume", loja, user?.id],
    enabled: !!client && pode,
    queryFn: () =>
      lerPaginas<TarifaFrete>(async (inicio, fim) => {
        const { data, error } = await client!
          .from("loja_fretes_volume")
          .select("cidade,uf,produto_id,valor_unitario,ativo")
          .eq("centro_id", loja)
          .order("cidade")
          .order("uf")
          .order("produto_id")
          .range(inicio, fim);
        return { data: data as TarifaFrete[] | null, error };
      }),
  });
  const tarifasPorCidade = useMemo(() => {
    const mapa = new Map<string, TarifaFrete[]>();
    for (const t of tarifas.data ?? []) {
      const key = chaveLocal(t);
      const lista = mapa.get(key) ?? [];
      lista.push(t);
      mapa.set(key, lista);
    }
    return mapa;
  }, [tarifas.data]);
  const opcoes = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of produtos.data ?? [])
      if (modo !== "produto" && p[modo]?.trim()) map.set(chaveGrupo(p[modo]), p[modo]);
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [produtos.data, modo]);
  const escopo = (produtos.data ?? []).filter(
    (p) => alvo && (modo === "produto" ? p.id === alvo : chaveGrupo(p[modo]) === alvo),
  );
  const unidades = [...new Set(escopo.map((p) => chaveGrupo(p.unidade ?? "")))].sort();
  const elegiveis = escopo.filter(
    (p) => !unidade || (chaveGrupo(p.unidade ?? "") || "__SEM_UNIDADE__") === unidade,
  );
  const selecionados = elegiveis.filter((p) => !excluidos.includes(p.id));
  const ids = selecionados.map((p) => p.id);
  const mesmaUnidade = new Set(selecionados.map((p) => chaveGrupo(p.unidade ?? ""))).size <= 1;
  const temEdicoes = Object.keys(edicoes).length > 0;
  const linhas = (cidades.data ?? []).map((c) => ({
    ...c,
    key: chaveLocal(c),
    base: tarifaComum(c, ids, tarifasPorCidade.get(chaveLocal(c)) ?? []),
  }));
  const mudouEscopo = (fn: () => void) => {
    if (
      temEdicoes &&
      !window.confirm("Descartar os valores por cidade ainda não salvos antes de mudar a seleção?")
    )
      return;
    setEdicoes({});
    fn();
  };
  const salvar = useMutation({
    mutationFn: async () => {
      if (!ids.length || !mesmaUnidade)
        throw new Error("Selecione produtos com a mesma unidade de venda.");
      const alteradas = linhas.filter((c) => edicoes[c.key]);
      if (!alteradas.length) throw new Error("Edite pelo menos uma cidade.");
      if (alteradas.length * ids.length > 5000)
        throw new Error(
          "O limite é de 5.000 tarifas por salvamento. Reduza as cidades editadas ou os produtos selecionados.",
        );
      const payload = alteradas.map((c) => {
        const v = edicoes[c.key]!;
        if (
          !v.valor.trim() ||
          !Number.isFinite(Number(v.valor)) ||
          Number(v.valor) < 0 ||
          Math.round(Number(v.valor) * 100) / 100 !== Number(v.valor)
        )
          throw new Error(`Confira o valor de ${c.cidade}/${c.uf}: até duas casas decimais.`);
        return { cidade: c.cidade, uf: c.uf, valor: Number(v.valor), ativo: v.ativo };
      });
      const { data, error } = await client!.rpc("salvar_grade_frete_volume_251", {
        _loja: loja,
        _produtos: ids,
        _cidades: payload,
      });
      if (error) throw new Error(error.message);
      await qc.invalidateQueries({ queryKey: ["tarifas-frete-volume"] });
      void qc.invalidateQueries({ queryKey: ["pendencias"] });
      return Number(data);
    },
    onSuccess: (n) => {
      setEdicoes({});
      toast.success(`${n} tarifa(s) salva(s) para os produtos selecionados.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const carregando = cidades.isPending || produtos.isPending || tarifas.isPending;
  if (!pode) return null;
  const listaProdutos = (produtos.data ?? [])
    .filter((p) => chaveGrupo(`${p.codigo} ${p.descricao}`).includes(chaveGrupo(busca)))
    .slice(0, 100);
  const visiveis = linhas.filter((c) =>
    chaveGrupo(`${c.cidade} ${c.uf}`).includes(chaveGrupo(filtroCidade)),
  );
  return (
    <section className="rounded-xl border p-4 space-y-4" aria-label="Configurar frete por volume">
      <div>
        <h3 className="font-semibold">Frete por volume</h3>
        <p className="text-sm text-muted-foreground">
          Escolha produto, grupo ou categoria e preencha as tarifas cidade por cidade na mesma
          lista. O valor de cada cidade será aplicado por unidade a todos os produtos selecionados.
        </p>
      </div>
      {(cidades.error || produtos.error || tarifas.error) && (
        <p role="alert" className="text-sm text-destructive">
          {(cidades.error || produtos.error || tarifas.error)?.message}
        </p>
      )}
      <fieldset disabled={salvar.isPending} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="frete-modo">Configurar por</Label>
            <select
              id="frete-modo"
              className="h-10 w-full rounded-md border bg-background px-3"
              value={modo}
              onChange={(e) =>
                mudouEscopo(() => {
                  setModo(e.target.value as Modo);
                  setAlvo("");
                  setUnidade("");
                  setExcluidos([]);
                })
              }
            >
              <option value="produto">Produto</option>
              <option value="grupo">Grupo</option>
              <option value="categoria">Categoria</option>
            </select>
          </div>
          {modo === "produto" && (
            <div className="space-y-1">
              <Label htmlFor="frete-busca-produto">Buscar produto</Label>
              <Input
                id="frete-busca-produto"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Código ou nome"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="frete-alvo">
              {modo === "produto" ? "Produto" : modo === "grupo" ? "Grupo" : "Categoria"}
            </Label>
            <select
              id="frete-alvo"
              className="h-10 w-full rounded-md border bg-background px-3"
              value={alvo}
              onChange={(e) =>
                mudouEscopo(() => {
                  setAlvo(e.target.value);
                  setUnidade("");
                  setExcluidos([]);
                })
              }
            >
              <option value="">Selecione</option>
              {modo === "produto" ? (
                <>
                  {alvo && !listaProdutos.some((p) => p.id === alvo) && (
                    <option value={alvo}>
                      {produtos.data?.find((p) => p.id === alvo)?.descricao}
                    </option>
                  )}
                  {listaProdutos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo} · {p.descricao}
                    </option>
                  ))}
                </>
              ) : (
                opcoes.map(([k, n]) => (
                  <option key={k} value={k}>
                    {n}
                  </option>
                ))
              )}
            </select>
            {modo === "produto" && (
              <p className="text-xs text-muted-foreground">Até 100 resultados por busca.</p>
            )}
          </div>
          {unidades.length > 1 && (
            <div className="space-y-1">
              <Label htmlFor="frete-unidade">Unidade de venda</Label>
              <select
                id="frete-unidade"
                className="h-10 w-full rounded-md border bg-background px-3"
                value={unidade}
                onChange={(e) =>
                  mudouEscopo(() => {
                    setUnidade(e.target.value);
                    setExcluidos([]);
                  })
                }
              >
                <option value="">Todas as unidades</option>
                {unidades.map((u) => (
                  <option key={u} value={u || "__SEM_UNIDADE__"}>
                    {u || "Não informada"}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {alvo && (
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex flex-wrap justify-between gap-2">
              <h4 className="text-sm font-semibold">
                Produtos da seleção · {selecionados.length} de {elegiveis.length}
              </h4>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mudouEscopo(() => setExcluidos([]))}
                >
                  Selecionar todos os produtos
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => mudouEscopo(() => setExcluidos(elegiveis.map((p) => p.id)))}
                >
                  Desmarcar produtos
                </Button>
              </div>
            </div>
            <div className="max-h-48 overflow-auto grid gap-1 md:grid-cols-2">
              {elegiveis.map((p) => (
                <label key={p.id} className="flex gap-2 items-center text-sm p-1">
                  <input
                    type="checkbox"
                    checked={!excluidos.includes(p.id)}
                    onChange={() =>
                      mudouEscopo(() =>
                        setExcluidos((s) =>
                          s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id],
                        ),
                      )
                    }
                  />
                  {p.codigo} · {p.descricao} ({p.unidade || "un."})
                </label>
              ))}
            </div>
          </div>
        )}
        {!mesmaUnidade && (
          <p role="alert" className="text-sm text-amber-700">
            O grupo contém unidades diferentes. Filtre a unidade ou selecione produtos com a mesma
            unidade para evitar aplicar frete de saco a produtos vendidos em KG.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="max-w-md"
            aria-label="Filtrar cidades do frete"
            placeholder="Filtrar cidade ou UF"
            value={filtroCidade}
            onChange={(e) => setFiltroCidade(e.target.value)}
          />
          <span className="text-sm text-muted-foreground">
            {visiveis.length} de {linhas.length} cidades · {Object.keys(edicoes).length} editada(s)
          </span>
        </div>
        <div className="max-h-[32rem] overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted">
              <tr className="text-left">
                <th className="p-3">Cidade / UF</th>
                <th className="p-3">Frete por unidade (R$)</th>
                <th className="p-3">Ativa</th>
                <th className="p-3">Tarifa atual</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c) => {
                const atual = edicoes[c.key] ?? c.base;
                return (
                  <tr key={c.key} className={edicoes[c.key] ? "border-t bg-primary/5" : "border-t"}>
                    <td className="p-3 font-medium">
                      {c.cidade} / {c.uf || "—"}
                    </td>
                    <td className="p-3">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label={`Frete ${c.cidade} / ${c.uf}`}
                        value={atual.valor}
                        placeholder={
                          c.base.situacao === "Sem tarifa"
                            ? "Não configurado"
                            : "Valores diferentes"
                        }
                        disabled={!ids.length || !mesmaUnidade || carregando}
                        onChange={(e) =>
                          setEdicoes((s) => ({
                            ...s,
                            [c.key]: { valor: e.target.value, ativo: atual.ativo },
                          }))
                        }
                      />
                    </td>
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label={`Ativar frete ${c.cidade} / ${c.uf}`}
                        checked={atual.ativo}
                        disabled={!ids.length || !mesmaUnidade || carregando}
                        onChange={(e) =>
                          setEdicoes((s) => ({
                            ...s,
                            [c.key]: { valor: atual.valor, ativo: e.target.checked },
                          }))
                        }
                      />
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {c.base.situacao}
                      {edicoes[c.key] && (
                        <span className="block text-primary">Alteração pendente</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visiveis.length && (
            <p className="p-3 text-sm text-muted-foreground">
              {carregando
                ? "Carregando cidades…"
                : "Nenhuma cidade encontrada no cadastro dos clientes."}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={
              salvar.isPending ||
              carregando ||
              !temEdicoes ||
              !ids.length ||
              !mesmaUnidade ||
              !!tarifas.error ||
              !!cidades.error ||
              !!produtos.error
            }
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending
              ? "Salvando…"
              : `Salvar alterações (${Object.keys(edicoes).length} cidades × ${ids.length} produtos)`}
          </Button>
          <Button
            variant="outline"
            disabled={!temEdicoes || salvar.isPending}
            onClick={() => setEdicoes({})}
          >
            Descartar alterações
          </Button>
        </div>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Somente as cidades editadas são salvas, inclusive as ocultas pelo filtro. Tarifas diferentes
        ou parciais são preservadas até você informar um novo valor. O lote inclui os produtos
        selecionados agora; novos produtos precisam ser configurados depois. Pedidos aprovados
        conservam seus valores. Limite de 5.000 tarifas por salvamento.
      </p>
    </section>
  );
}
