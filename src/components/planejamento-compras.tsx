import { useCentroValido } from "@/lib/centros-acesso";
import { filtrarCentro } from "@/lib/centro-store";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calculator,
  Download,
  Loader2,
  PackageSearch,
  Printer,
  RefreshCw,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { lerPaginas } from "@/lib/paginacao";
import { brl, dataBr } from "@/lib/formatacao";
import { exportarCsv } from "@/lib/exportar";
import {
  BASES_CONSUMO,
  CONFIG_COMPRA,
  METODOS_COMPRA,
  calcularCompra,
  qtdCompra,
  validarConfigCompra,
  type ConfigCompra,
  type FonteCompra,
} from "@/lib/planejamento-compras";
const chave = (r: FonteCompra) => `${r["centro_id"]}-${r["produto_id"]}`;
const numero = (v: unknown) => Number(v ?? 0);
const cor = (s: string) =>
  s === "Ruptura"
    ? "border-red-200 bg-red-50 text-red-800"
    : s === "Comprar"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : s === "Revisar parâmetros"
        ? "border-red-200 bg-red-50 text-red-800"
        : s === "Aguardar trânsito"
          ? "border-blue-200 bg-blue-50 text-blue-800"
          : "bg-muted text-muted-foreground";
const prioridades = [
  "Ruptura",
  "Comprar",
  "Revisar parâmetros",
  "Aguardar trânsito",
  "Sem giro",
  "Abastecido",
];
const dias = (n: number | null) =>
  n === null ? "Sem consumo" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;

export function PlanejamentoCompras() {
  const { client, user, roles } = useSupabase(),
    perm = usePermissoesRotinas();
  const cv = useCentroValido();
  const [config, setConfig] = useState<ConfigCompra>({ ...CONFIG_COMPRA });
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const setF = (k: string, v: string) => setFiltros((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    setFiltros({});
    setSelecionados(new Set());
    setDetalhe(null);
  }, [cv.centro]);
  const lista = useQuery({
    queryKey: ["planejamento-compras-294", user?.id, roles.slice().sort().join(","), cv.centro],
    enabled:
      !!client &&
      perm.pode("compras_planejar") &&
      !cv.isLoading &&
      !cv.error &&
      cv.lista.length > 0,
    queryFn: () =>
      lerPaginas<FonteCompra>((inicio, fim) => {
        let q = client!.from("vw_planejamento_compras_294").select("*");
        if (cv.centro) q = q.eq("centro_id", cv.centro);
        return q.order("centro_id").order("produto_id").range(inicio, fim);
      }),
    refetchInterval: 60_000,
  });
  const dadosDaLoja = useMemo(
    () => (cv.isLoading || cv.error ? [] : filtrarCentro(lista.data ?? [], cv.centro)),
    [lista.data, cv.centro, cv.isLoading, cv.error],
  );
  const nomeLoja = cv.centro
    ? (cv.lista.find((l) => l.id === cv.centro)?.nome ?? "Loja selecionada")
    : "Todas as lojas permitidas";
  const erros = validarConfigCompra(config);
  const calculados = useMemo(
    () => dadosDaLoja.map((r) => ({ r, c: calcularCompra(r, config) })),
    [dadosDaLoja, config],
  );
  const opcoes = (campo: string) =>
    [...new Set(dadosDaLoja.map((r) => String(r[campo] ?? "")).filter(Boolean))]
      .sort()
      .map((v) => ({ value: v, label: v }));
  const rows = useMemo(() => {
    const termo = (filtros["busca"] ?? "").trim().toLocaleLowerCase("pt-BR");
    const result = calculados.filter(
      ({ r, c }) =>
        (!termo || `${r["codigo"]} ${r["descricao"]}`.toLocaleLowerCase("pt-BR").includes(termo)) &&
        ["grupo", "marca", "fornecedor"].every(
          (k) => !filtros[k] || String(r[k] ?? "") === filtros[k],
        ) &&
        (!filtros["situacao"] || c.status === filtros["situacao"]) &&
        (filtros["sugestao"] !== "1" || c.sugestao > 0),
    );
    return result.sort((a, b) =>
      filtros["ordem"] === "produto"
        ? String(a.r["descricao"]).localeCompare(String(b.r["descricao"]), "pt-BR")
        : filtros["ordem"] === "investimento"
          ? (b.c.investimento ?? 0) - (a.c.investimento ?? 0)
          : prioridades.indexOf(a.c.status) - prioridades.indexOf(b.c.status) ||
            (b.c.investimento ?? 0) - (a.c.investimento ?? 0) ||
            String(a.r["descricao"]).localeCompare(String(b.r["descricao"]), "pt-BR"),
    );
  }, [calculados, filtros]);
  const selecao = rows.filter(({ r }) => selecionados.has(chave(r))),
    exportados = selecao.length ? selecao : rows;
  const atual = calculados.find(({ r }) => chave(r) === detalhe);
  const investimento = rows.reduce((s, { c }) => s + (c.investimento ?? 0), 0),
    semCusto = rows.filter(({ c }) => c.sugestao > 0 && c.investimento === null).length;
  function exportar() {
    exportarCsv(
      "planejamento-compras",
      [
        ["produto", "Produto"],
        ["loja", "Loja"],
        ["fornecedor", "Último fornecedor"],
        ["unidade", "Unidade"],
        ["estoque", "Estoque"],
        ["pendencia", "Pendência aprovada"],
        ["transito", "Comprado (em trânsito)"],
        ["minimo", "Mínimo"],
        ["media", "Média mês"],
        ["v30", "30d"],
        ["v60", "60d"],
        ["v90", "90d"],
        ["v120", "120d"],
        ["sugestao", "Sugestão"],
        ["prazo", "Prazo fornecedor (dias)"],
        ["cobertura", "Cobertura disponível"],
        ["custo", "Custo referência"],
        ["investimento", "Investimento estimado"],
        ["situacao", "Situação"],
        ["metodo", "Método"],
        ["base", "Base de consumo"],
        ["alvo", "Estoque alvo"],
        ["posicao", "Posição projetada"],
        ["multiplo", "Múltiplo"],
        ["config", "Parâmetros"],
        ["alertas", "Alertas"],
      ].map(([key, label]) => ({ key: key!, label: label! })),
      exportados.map(({ r, c }) => ({
        produto: `${r["codigo"]} · ${r["descricao"]}`,
        loja: r["centro"],
        fornecedor: r["fornecedor"] ?? "Sem fornecedor anterior",
        unidade: r["unidade"],
        estoque: qtdCompra(c.estoque),
        pendencia: qtdCompra(c.pendencia),
        transito: qtdCompra(numero(r["em_transito"])),
        minimo: qtdCompra(c.minimo),
        media: qtdCompra(c.mediaMes),
        v30: qtdCompra(numero(r["venda_30"])),
        v60: qtdCompra(numero(r["venda_60"])),
        v90: qtdCompra(numero(r["venda_90"])),
        v120: qtdCompra(numero(r["venda_120"])),
        sugestao: c.erros.length ? "Revisar parâmetros" : qtdCompra(c.sugestao),
        prazo: c.prazo,
        cobertura: dias(c.cobertura),
        custo: c.custo === null ? "Não informado" : brl(c.custo),
        investimento: c.investimento === null ? "Não estimado" : brl(c.investimento),
        situacao: c.status,
        metodo: METODOS_COMPRA[config.metodo],
        base: BASES_CONSUMO[config.base],
        alvo: qtdCompra(c.alvo),
        posicao: qtdCompra(c.posicao),
        multiplo: qtdCompra(c.multiplo),
        config: `Cobertura ${config.cobertura}d; segurança ${config.seguranca}d; ajuste ${config.ajuste}%; prazo produto ${config.usarPrazoProduto ? "sim" : "não"}; prazo padrão ${config.prazoPadrao}d; trânsito ${config.considerarTransito ? "sim" : "não"}; lote mínimo ${config.loteMinimo}`,
        alertas: [...c.erros, ...c.avisos].join(" · "),
      })),
    );
  }
  if (!perm.pode("compras_planejar"))
    return <p role="status">Planejamento de compras não liberado para seu perfil.</p>;
  const formularioNumero = (
    key: "cobertura" | "prazoPadrao" | "seguranca" | "ajuste" | "multiplo" | "loteMinimo",
    label: string,
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`plan-${key}`}>{label}</Label>
      <Input
        id={`plan-${key}`}
        type="number"
        step={key === "multiplo" || key === "loteMinimo" ? "0.001" : "1"}
        value={Number.isFinite(config[key]) ? config[key] : ""}
        onChange={(e) =>
          setConfig((c) => ({ ...c, [key]: e.target.value === "" ? NaN : Number(e.target.value) }))
        }
      />
    </div>
  );
  if (cv.isLoading) return <p role="status">Carregando lojas permitidas…</p>;
  if (cv.error)
    return (
      <p role="alert" className="text-destructive">
        Não foi possível validar a loja: {cv.error.message}
      </p>
    );
  if (!cv.lista.length) return <p role="status">Nenhuma loja liberada para planejamento.</p>;
  return (
    <section className="min-w-0 space-y-5">
      <style media="print">{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      <div className="no-print rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl space-y-2">
            <Badge variant="outline" className="bg-card">
              Compras · Planejamento · {nomeLoja}
            </Badge>
            <h2 className="text-xl font-semibold sm:text-2xl">Comprar na medida certa</h2>
            <p className="text-sm text-muted-foreground">
              Priorize faltas, simule a reposição e confira o investimento por loja antes de
              negociar com o fornecedor.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={lista.isFetching}
              onClick={() => lista.refetch()}
            >
              <RefreshCw className="size-4" />
              Atualizar
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!!erros.length || !rows.length || lista.isFetching || lista.isError}
              onClick={() => window.print()}
            >
              <Printer className="size-4" />
              Imprimir
            </Button>
            <Button
              size="sm"
              disabled={!!erros.length || !rows.length || lista.isFetching || lista.isError}
              onClick={exportar}
            >
              <Download className="size-4" />
              {selecao.length ? `Exportar seleção (${selecao.length})` : "Exportar planejamento"}
            </Button>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Somente pedidos aprovados e vendas que avançaram no fluxo. Digitação, análise, recusados e
          cancelados ficam fora. Cada produto usa o estoque e as compras da sua loja.
        </p>
      </div>
      <div className="no-print grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            titulo: "Itens para comprar",
            valor: rows.filter((x) => x.c.sugestao > 0).length,
            nota: `${rows.length} produtos/lojas no filtro`,
            Icon: ShoppingCart,
          },
          {
            titulo: "Ruptura / falta",
            valor: rows.filter((x) => x.c.disponivel < 0).length,
            nota: "Estoque menos pendências aprovadas",
            Icon: PackageSearch,
          },
          {
            titulo: "Investimento estimado",
            valor: brl(investimento),
            nota: semCusto
              ? `${semCusto} item(ns) sem custo fora desta estimativa`
              : "Referência de custo, sem frete ou tributos adicionais",
            Icon: Calculator,
          },
          {
            titulo: "Produtos em trânsito",
            valor: rows.filter((x) => numero(x.r["em_transito"]) > 0).length,
            nota: "Compras marcadas como Comprado, ainda não recebidas",
            Icon: Truck,
          },
        ].map((k) => (
          <div key={k.titulo} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{k.titulo}</span>
              <k.Icon className="size-4" />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {lista.isPending || lista.isError ? "—" : k.valor}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{k.nota}</p>
          </div>
        ))}
      </div>
      <details className="no-print rounded-xl border bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Como calcular a compra · {METODOS_COMPRA[config.metodo]}{" "}
          <span className="font-normal text-muted-foreground">· ajustar método e parâmetros</span>
        </summary>
        <div className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Como calcular a compra</h3>
            <Button size="sm" variant="ghost" onClick={() => setConfig({ ...CONFIG_COMPRA })}>
              Restaurar cálculo padrão
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="plan-metodo">Método de reposição</Label>
              <select
                id="plan-metodo"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={config.metodo}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, metodo: e.target.value as ConfigCompra["metodo"] }))
                }
              >
                {Object.entries(METODOS_COMPRA).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="plan-base">Base de consumo</Label>
              <select
                id="plan-base"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={config.base}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, base: e.target.value as ConfigCompra["base"] }))
                }
              >
                {Object.entries(BASES_CONSUMO).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            {formularioNumero("cobertura", "Cobertura alvo (dias)")}
            {formularioNumero("prazoPadrao", "Prazo padrão do fornecedor (dias)")}
          </div>
          <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            {config.metodo === "cobertura"
              ? "Alvo = mínimo + consumo diário × (cobertura + prazo de entrega + segurança). A compra cobre o que falta após descontar estoque e trânsito e considerar a pendência aprovada."
              : config.metodo === "minimo"
                ? "Repõe até o estoque mínimo, considerando pendências aprovadas e compras em trânsito. Não adiciona uma projeção de vendas futuras."
                : config.metodo === "minmax"
                  ? "Ao atingir o ponto de reposição, compra o necessário para chegar ao máximo cadastrado. Produtos sem máximo válido pedem revisão dos parâmetros."
                  : "Cobre a falta do estoque após as pendências aprovadas e o trânsito, sem adicionar estoque mínimo ou previsão de vendas futuras."}
          </p>
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Parâmetros avançados: segurança, demanda e lotes
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {formularioNumero("seguranca", "Segurança adicional (dias)")}
              {formularioNumero("ajuste", "Ajuste de demanda (%)")}
              {formularioNumero("multiplo", "Múltiplo de compra (0 = pela unidade)")}
              {formularioNumero("loteMinimo", "Lote mínimo de compra")}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.usarPrazoProduto}
                  onChange={(e) => setConfig((c) => ({ ...c, usarPrazoProduto: e.target.checked }))}
                />
                Usar prazo cadastrado no produto; prazo padrão quando não informado
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.considerarTransito}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, considerarTransito: e.target.checked }))
                  }
                />
                Descontar compras em trânsito da necessidade
              </label>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Ponderada: quatro faixas de 30 dias com pesos 4, 3, 2 e 1, do recente ao antigo.
              Múltiplo automático: 1 para unidades inteiras e 0,001 para unidades fracionadas. Lotes
              informados aqui valem para toda a simulação; confira embalagem e pedido mínimo com
              cada fornecedor.
            </p>
          </details>
          {!!erros.length && (
            <div role="alert" className="text-sm text-destructive">
              {erros.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}
        </div>
      </details>
      <FilterBar onClear={() => setFiltros({})}>
        <FilterText
          label="Buscar produto"
          placeholder="Código ou descrição…"
          value={filtros["busca"] ?? ""}
          onChange={(v) => setF("busca", v)}
        />
        {["grupo", "marca", "fornecedor"].map((k) => (
          <FilterSelect
            key={k}
            label={k === "fornecedor" ? "Último fornecedor" : k === "grupo" ? "Grupo" : "Marca"}
            value={filtros[k] ?? ""}
            onChange={(v) => setF(k, v)}
            options={opcoes(k)}
          />
        ))}
        <FilterSelect
          label="Prioridade"
          value={filtros["situacao"] ?? ""}
          onChange={(v) => setF("situacao", v)}
          options={prioridades.map((v) => ({ value: v, label: v }))}
        />
        <FilterSelect
          label="Sugestão"
          value={filtros["sugestao"] ?? ""}
          onChange={(v) => setF("sugestao", v)}
          options={[{ value: "1", label: "Somente com compra sugerida" }]}
          allLabel="Todos os produtos"
        />
        <FilterSelect
          label="Ordenar por"
          value={filtros["ordem"] ?? "prioridade"}
          onChange={(v) => setF("ordem", v)}
          options={[
            { value: "prioridade", label: "Prioridade de reposição" },
            { value: "produto", label: "Produto" },
            { value: "investimento", label: "Maior investimento" },
          ]}
        />
      </FilterBar>
      <div className="print-area planejamento-print min-w-0 rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h3 className="font-semibold">Plano de abastecimento · {nomeLoja}</h3>
            <p className="text-xs text-muted-foreground">
              {rows.length} produtos/lojas · dados de {dataBr(lista.data?.[0]?.["data_referencia"])}{" "}
              · vendas líquidas de devoluções confirmadas · períodos acumulados
            </p>
          </div>
          <p className="text-xs text-muted-foreground no-print">
            {selecao.length} selecionado(s) nos filtros atuais
            {selecao.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelecionados(new Set())}>
                Limpar seleção
              </Button>
            )}
          </p>
        </div>
        <p className="hidden p-3 text-xs print:block">
          Loja: {nomeLoja} · {METODOS_COMPRA[config.metodo]} · {BASES_CONSUMO[config.base]} ·
          cobertura {config.cobertura}d · segurança {config.seguranca}d · ajuste {config.ajuste}% ·
          trânsito {config.considerarTransito ? "considerado" : "desconsiderado"} · investimento
          estimado {brl(investimento)}.{" "}
          {[
            filtros["busca"],
            filtros["grupo"],
            filtros["marca"],
            filtros["fornecedor"],
            filtros["situacao"],
          ]
            .filter(Boolean)
            .join(" · ") || "Sem filtros adicionais"}
        </p>
        {lista.isPending ? (
          <p className="flex items-center gap-2 p-6 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Carregando planejamento…
          </p>
        ) : lista.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            Não foi possível consultar o planejamento. {lista.error.message}
          </p>
        ) : !rows.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nenhum produto nos filtros selecionados.
          </p>
        ) : (
          <Table className="mobile-cards planejamento-list">
            <TableHeader>
              <TableRow>
                <TableHead className="no-print w-10">
                  <span className="sr-only">Selecionar</span>
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos os produtos filtrados"
                    checked={rows.length > 0 && selecao.length === rows.length}
                    onChange={(e) =>
                      setSelecionados((s) => {
                        const next = new Set(s);
                        for (const { r } of rows) {
                          if (e.target.checked) next.add(chave(r));
                          else next.delete(chave(r));
                        }
                        return next;
                      })
                    }
                  />
                </TableHead>
                <TableHead>Produto</TableHead>
                {[
                  "Estoque",
                  "Comprado (em trânsito)",
                  "Mínimo",
                  "Média mês",
                  "30d",
                  "60d",
                  "90d",
                  "120d",
                  "Sugestão",
                  "Cobertura",
                  "Investimento",
                  "Situação",
                ].map((t) => (
                  <TableHead key={t} data-label={t} className="text-right">
                    {t}
                  </TableHead>
                ))}
                <TableHead className="no-print text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ r, c }) => (
                <TableRow key={chave(r)}>
                  <TableCell data-label="Selecionar" className="no-print">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${String(r["descricao"])} na loja ${String(r["centro"])}`}
                      checked={selecionados.has(chave(r))}
                      onChange={(e) =>
                        setSelecionados((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(chave(r));
                          else next.delete(chave(r));
                          return next;
                        })
                      }
                    />
                  </TableCell>
                  <TableCell data-label="Produto">
                    <p className="font-medium">
                      {String(r["codigo"])} · {String(r["descricao"])}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {String(r["centro"])} · {String(r["unidade"] ?? "UN")}
                    </p>
                  </TableCell>
                  <TableCell
                    data-label="Estoque"
                    className={`text-right tabular-nums ${c.estoque < 0 ? "text-destructive font-semibold" : ""}`}
                  >
                    {qtdCompra(c.estoque)}
                  </TableCell>

                  <TableCell
                    data-label="Comprado (em trânsito)"
                    className="text-right tabular-nums"
                  >
                    {qtdCompra(numero(r["em_transito"]))}
                  </TableCell>
                  <TableCell data-label="Mínimo" className="text-right tabular-nums">
                    {qtdCompra(c.minimo)}
                  </TableCell>
                  <TableCell
                    data-label="Média mês"
                    className="text-right tabular-nums"
                    title="Equivalente a 30 dias de consumo pela base e ajuste escolhidos"
                  >
                    {qtdCompra(c.mediaMes)}
                  </TableCell>
                  {[30, 60, 90, 120].map((n) => (
                    <TableCell key={n} data-label={`${n}d`} className="text-right tabular-nums">
                      {qtdCompra(numero(r[`venda_${n}`]))}
                    </TableCell>
                  ))}
                  <TableCell
                    data-label="Sugestão"
                    className="text-right font-semibold tabular-nums text-primary"
                  >
                    {c.erros.length ? "Revisar" : qtdCompra(c.sugestao)}
                  </TableCell>
                  <TableCell
                    data-label="Cobertura"
                    className="text-right text-xs"
                    title="Dias que o estoque menos as pendências aprovadas atende ao consumo diário. Não inclui compras ainda em trânsito."
                  >
                    {dias(c.cobertura)}
                  </TableCell>
                  <TableCell data-label="Investimento" className="text-right tabular-nums">
                    {c.investimento === null ? "Sem custo" : brl(c.investimento)}
                  </TableCell>
                  <TableCell data-label="Situação" className="text-right">
                    <Badge
                      variant="outline"
                      className={`whitespace-nowrap text-[11px] ${cor(c.status)}`}
                    >
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell data-label="Ações" className="no-print text-right">
                    <Button size="sm" variant="outline" onClick={() => setDetalhe(chave(r))}>
                      <Calculator className="size-3.5" />
                      Cálculo
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="border-t p-3 text-xs text-muted-foreground">
          Sugestão para revisão e cotação. Exportar ou imprimir não cria compra, não reserva estoque
          e não gera contas a pagar. Confirme prazo de entrega, embalagem, preço e fornecedor antes
          de comprar.
        </p>
      </div>
      <Dialog
        open={!!atual}
        onOpenChange={(open) => {
          if (!open) setDetalhe(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Memória de cálculo</DialogTitle>
            <DialogDescription>
              {String(atual?.r["codigo"] ?? "")} · {String(atual?.r["descricao"] ?? "")} ·{" "}
              {String(atual?.r["centro"] ?? "")}
            </DialogDescription>
          </DialogHeader>
          {atual && (
            <>
              <div className="grid gap-2 rounded-xl bg-muted/40 p-4 text-sm sm:grid-cols-2">
                {[
                  ["Método", METODOS_COMPRA[config.metodo]],
                  ["Base de consumo", BASES_CONSUMO[config.base]],
                  ["Consumo diário ajustado", qtdCompra(atual.c.diario)],
                  ["Prazo usado", `${atual.c.prazo} dias`],
                  ["Estoque físico", qtdCompra(atual.c.estoque)],
                  ["Pendência aprovada", qtdCompra(atual.c.pendencia)],
                  ["Trânsito considerado", qtdCompra(atual.c.transito)],
                  ["Posição projetada", qtdCompra(atual.c.posicao)],
                  ["Cobertura atual", dias(atual.c.cobertura)],
                  ["Ponto de reposição", qtdCompra(atual.c.ponto)],
                  ["Estoque alvo", qtdCompra(atual.c.alvo)],
                  ["Necessidade antes do lote", qtdCompra(atual.c.necessidade)],
                  ["Múltiplo aplicado", qtdCompra(atual.c.multiplo)],
                ].map(([t, v]) => (
                  <div key={t}>
                    <p className="text-xs text-muted-foreground">{t}</p>
                    <p className="font-medium">{v}</p>
                  </div>
                ))}
              </div>
              <p className="text-sm">
                Posição = {qtdCompra(atual.c.estoque)} de estoque − {qtdCompra(atual.c.pendencia)}{" "}
                de pendência + {qtdCompra(atual.c.transito)} em trânsito. A necessidade positiva é
                elevada ao lote mínimo e ao próximo múltiplo de compra.
              </p>
              <p className="rounded-lg border border-primary/20 bg-primary/10 p-3 font-semibold">
                Sugestão:{" "}
                {atual.c.erros.length
                  ? "Revisar parâmetros"
                  : `${qtdCompra(atual.c.sugestao)} ${String(atual.r["unidade"] ?? "")}`}{" "}
                · investimento{" "}
                {atual.c.investimento === null ? "não estimado" : brl(atual.c.investimento)}
              </p>
              <p className="text-xs text-muted-foreground">
                Custo de referência: {atual.c.custo === null ? "não informado" : brl(atual.c.custo)}{" "}
                · {String(atual.r["origem_custo"])}. Primeiro pedido aprovado:{" "}
                {dataBr(atual.r["primeira_venda"])}. Janela de 30 dias inclui hoje e os 29
                anteriores; as demais janelas seguem o mesmo critério. Devoluções confirmadas
                reduzem a venda de origem.
              </p>
              {[...atual.c.erros, ...atual.c.avisos].map((a) => (
                <p
                  key={a}
                  className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"
                >
                  {a}
                </p>
              ))}
              <h3 className="font-semibold">Comparar métodos com os mesmos parâmetros</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(METODOS_COMPRA).map(([k, t]) => {
                  const c = calcularCompra(atual.r, {
                    ...config,
                    metodo: k as ConfigCompra["metodo"],
                  });
                  return (
                    <div key={k} className="rounded-lg border p-3 text-sm">
                      <p className="text-xs text-muted-foreground">{t}</p>
                      <p className="font-semibold">
                        {c.erros.length
                          ? "Revisar parâmetros"
                          : `${qtdCompra(c.sugestao)} ${String(atual.r["unidade"] ?? "")}`}
                      </p>
                    </div>
                  );
                })}
              </div>
              <Button variant="outline" onClick={() => setDetalhe(null)}>
                Fechar cálculo
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
