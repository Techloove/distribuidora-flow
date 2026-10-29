import { ReferenciaRegistro } from "@/components/referencia-registro";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer, RefreshCw } from "lucide-react";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSupabase } from "@/lib/supabase-provider";
import { useCentroValido } from "@/lib/centros-acesso";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { exportarCsv, type Coluna } from "@/lib/exportar";
import { brl } from "@/lib/formatacao";
import { dataAgenda } from "@/lib/agenda-comercial";
import {
  filtrosVendasIniciais,
  GRUPOS_VENDAS,
  numeroVendas as n,
  periodoMesVendas,
  variacaoVendas,
  type LinhaRelatorio as Linha,
  type RelatorioVendas,
} from "@/lib/relatorios-vendas";

type Opcoes = {
  rotas: { id: string; nome: string }[];
  representantes: { id: string; nome: string }[];
  centros: { id: string; nome: string }[];
  cidades: string[];
};
const percentual = (v: unknown) =>
  v == null ? "—" : `${n(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const peso = (v: unknown) => `${n(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`;
const dinheiro = new Set([
  "vendas",
  "vendido",
  "bruto",
  "descontos",
  "devolucoes",
  "comissao",
  "custo",
  "frete",
  "tributos",
  "despesas",
  "ticket",
  "total",
  "paga",
  "a_pagar",
  "lucro_bruto_com",
  "lucro_bruto_sem",
  "lucro_liquido_com",
  "lucro_liquido_sem",
]);
function formatar(key: string, value: unknown) {
  if (value == null) return "—";
  if (key === "periodo") return value === "atual" ? "Atual" : "Anterior";
  if (dinheiro.has(key)) return brl(value);
  if (key === "margem") return percentual(value);
  if (key === "peso") return peso(value);
  if (key === "data_pedido") return dataAgenda(value);
  return String(value).replace(key === "status" ? /_/g : /$^/g, " ");
}
export function RelatoriosVendas() {
  const { client, user, roles, canManage } = useSupabase();
  const cv = useCentroValido(),
    perm = usePermissoesRotinas();
  const [filtros, setFiltros] = useState(filtrosVendasIniciais);
  const [busca, setBusca] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setBusca(filtros.busca), 300);
    return () => clearTimeout(t);
  }, [filtros.busca]);
  const [grupo, setGrupo] = useState("rota"),
    [ordem, setOrdem] = useState("vendas"),
    [asc, setAsc] = useState(false);
  const [comissao, setComissao] = useState("com");
  const [pagina, setPagina] = useState(0),
    [paginaPedidos, setPaginaPedidos] = useState(0);
  const [aba, setAba] = useState("visao");
  useEffect(() => {
    setPagina(0);
    setPaginaPedidos(0);
  }, [cv.centro, user?.id]);
  const restrita = roles.includes("representante") && !roles.includes("admin");
  const permitido = perm.pode("vendas_relatorio_ver");
  const centro = cv.centro || filtros.centro || null;
  const mesCompleto =
    filtros.inicio &&
    filtros.inicio.endsWith("-01") &&
    periodoMesVendas(filtros.inicio.slice(0, 7)).fim === filtros.fim
      ? filtros.inicio.slice(0, 7)
      : "";
  const escopo = roles.slice().sort().join(",");
  const valido =
    !!filtros.inicio &&
    !!filtros.fim &&
    filtros.inicio <= filtros.fim &&
    (Date.parse(filtros.fim) - Date.parse(filtros.inicio)) / 86400000 <= 366;
  const opcoes = useQuery({
    queryKey: ["relatorio_vendas_filtros_230", user?.id, escopo],
    enabled: !!client && permitido,
    queryFn: async () => {
      const { data, error } = await client!.rpc("relatorio_vendas_filtros_230");
      if (error) throw new Error(error.message);
      return data as Opcoes;
    },
  });
  const consulta = useQuery({
    queryKey: [
      "relatorio_vendas_230",
      user?.id,
      escopo,
      filtros.inicio,
      filtros.fim,
      centro,
      filtros.representante,
      filtros.rota,
      filtros.cidade,
      busca,
      filtros.status,
      grupo,
      ordem,
      asc,
      pagina,
      paginaPedidos,
      comissao,
    ],
    enabled: !!client && permitido && valido && !cv.isLoading && !cv.error,
    queryFn: async () => {
      const ordenacao =
        (ordem === "lucro_bruto" || ordem === "lucro_liquido" || ordem === "margem") &&
        comissao === "sem"
          ? `${ordem}_sem`
          : ordem;
      const { data, error } = await client!.rpc("relatorio_vendas_230", {
        _inicio: filtros.inicio,
        _fim: filtros.fim,
        _centro: centro,
        _representante: restrita ? null : filtros.representante || null,
        _rota: filtros.rota || null,
        _cidade: filtros.cidade,
        _busca: busca.trim(),
        _status: filtros.status,
        _grupo: grupo,
        _ordem: ordenacao,
        _asc: asc,
        _pagina: pagina,
        _pagina_pedidos: paginaPedidos,
      });
      if (error)
        throw new Error(
          /schema cache|does not exist|Could not find/.test(error.message)
            ? "Aplique a fase230 no Supabase para carregar os relatórios unificados."
            : error.message,
        );
      return data as RelatorioVendas;
    },
  });
  const dados = consulta.data,
    total = dados?.totais ?? {},
    anterior = dados?.anterior ?? {};
  const lucro = dados?.rentabilidade === true && perm.pode("vendas_rentabilidade_ver");
  const brutoKey = `lucro_bruto_${comissao}`,
    liquidoKey = `lucro_liquido_${comissao}`;
  const setF = (key: string, value: string) => {
    setFiltros((f) => ({ ...f, [key]: value }));
    setPagina(0);
    setPaginaPedidos(0);
  };
  const limpar = () => {
    setFiltros(filtrosVendasIniciais());
    setPagina(0);
    setPaginaPedidos(0);
  };
  const selecionarMes = (mes: string) => {
    if (mes) {
      setFiltros((f) => ({ ...f, ...periodoMesVendas(mes) }));
      setPagina(0);
      setPaginaPedidos(0);
    }
  };
  const colunasRanking: Coluna[] = [
    { key: "nome", label: GRUPOS_VENDAS.find((g) => g.value === grupo)?.label ?? "Grupo" },
    { key: "pedidos", label: "Pedidos" },
    { key: "vendas", label: "Vendas líquidas" },
    { key: "peso", label: "Peso" },
    { key: "comissao", label: "Comissão" },
    ...(lucro
      ? [
          { key: brutoKey, label: "Lucro bruto" },
          { key: liquidoKey, label: "Lucro líquido estimado" },
          { key: "margem_exibida", label: "Margem estimada %" },
        ]
      : []),
  ];
  const ranking = (dados?.ranking ?? []).map((r) => ({
    ...r,
    cliente_id: grupo === "cliente" ? r["chave"] : r["cliente_id"],
    margem_exibida: n(r["vendas"]) === 0 ? null : (n(r[liquidoKey]) / n(r["vendas"])) * 100,
  }));
  const colunasPedidos: Coluna[] = [
    { key: "numero", label: "Pedido" },
    { key: "data_pedido", label: "Data" },
    { key: "cliente", label: "Cliente" },
    { key: "representante", label: "Representante" },
    { key: "centro", label: "Centro" },
    { key: "rota", label: "Rota" },
    { key: "cidade", label: "Cidade / UF" },
    { key: "status", label: "Situação" },
    { key: "bruto", label: "Itens brutos" },
    { key: "descontos", label: "Descontos" },
    { key: "devolucoes", label: "Devoluções" },
    { key: "vendas", label: "Vendas líquidas" },
    { key: "peso", label: "Peso" },
    { key: "comissao", label: "Comissão" },
    ...(lucro
      ? [
          { key: "custo", label: "CMV" },
          { key: "frete", label: "Custo de frete" },
          { key: "tributos", label: "Tributos estimados" },
          { key: "despesas", label: "Despesas variáveis" },
          { key: brutoKey, label: "Lucro bruto" },
          { key: liquidoKey, label: "Lucro líquido estimado" },
        ]
      : []),
  ];
  if (!permitido)
    return (
      <p role="status" className="rounded-xl border p-5">
        {perm.carregando
          ? "Verificando acesso…"
          : "Seu perfil não tem permissão para consultar Relatórios de Vendas."}
      </p>
    );
  return (
    <div className="print-area space-y-5">
      <FilterBar onClear={limpar}>
        <FilterText
          label="De"
          type="date"
          value={filtros.inicio}
          onChange={(v) => setF("inicio", v)}
        />
        <FilterText label="Até" type="date" value={filtros.fim} onChange={(v) => setF("fim", v)} />
        <FilterText
          label="Selecionar mês completo"
          type="month"
          value={mesCompleto}
          onChange={selecionarMes}
        />
        <FilterText
          label="Cliente ou código"
          value={filtros.busca}
          onChange={(v) => setF("busca", v)}
          placeholder="Buscar na carteira"
        />
        {!restrita && (
          <FilterSelect
            label="Representante"
            value={filtros.representante}
            onChange={(v) => setF("representante", v)}
            options={(opcoes.data?.representantes ?? []).map((r) => ({
              value: r["id"],
              label: r["nome"],
            }))}
          />
        )}
        <FilterSelect
          label="Rota"
          value={filtros.rota}
          onChange={(v) => setF("rota", v)}
          options={(opcoes.data?.rotas ?? []).map((r) => ({ value: r["id"], label: r["nome"] }))}
        />
        <FilterSelect
          label="Cidade / UF"
          value={filtros.cidade}
          onChange={(v) => setF("cidade", v)}
          options={(opcoes.data?.cidades ?? []).map((c) => ({ value: c, label: c }))}
        />
        {!cv.centro && (
          <FilterSelect
            label="Centro de custo"
            value={filtros.centro}
            onChange={(v) => setF("centro", v)}
            options={(opcoes.data?.centros ?? []).map((r) => ({
              value: r["id"],
              label: r["nome"],
            }))}
          />
        )}
        <FilterSelect
          label="Situação do pedido"
          value={filtros.status}
          onChange={(v) => setF("status", v)}
          allLabel="Todas as vendas efetivadas"
          options={[
            "confirmado",
            "separacao",
            "separado",
            "conferido",
            "faturado",
            "nf_emitida",
            "em_carga",
            "em_rota",
            "entregue",
            "parcial",
            "nao_entregue",
            "devolvido",
          ].map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
        />
      </FilterBar>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {restrita
            ? "Somente vendas de sua carteira e de sua representação."
            : "Vendas dos centros e carteiras permitidos."}{" "}
          Por data do pedido.
        </p>
        <div className="flex gap-2 no-print">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void consulta.refetch()}
            disabled={!valido || consulta.isFetching || !!cv.error}
          >
            <RefreshCw className="size-4" /> Atualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            disabled={!dados || consulta.isFetching}
          >
            <Printer className="size-4" /> Imprimir
          </Button>
        </div>
      </div>
      {!valido && (
        <p role="alert" className="text-destructive">
          Informe um período válido de até 367 dias.
        </p>
      )}
      {[consulta.error, opcoes.error, cv.error].filter(Boolean).map((e, i) => (
        <p role="alert" key={i} className="rounded border p-4 text-sm text-destructive">
          {(e as Error).message}
        </p>
      ))}
      {valido && consulta.isPending && !consulta.error && (
        <p role="status">Apurando vendas e resultados…</p>
      )}
      {dados && (
        <>
          <section
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Indicadores de vendas"
          >
            <Indicador
              label="Total vendido no período"
              valor={brl(total["vendido"])}
              anterior={anterior["vendido"]}
              atual={total["vendido"]}
            />
            <Indicador
              label="Vendas líquidas após devoluções"
              valor={brl(total["vendas"])}
              anterior={anterior["vendas"]}
              atual={total["vendas"]}
            />
            <Indicador
              label="Pedidos / ticket médio"
              valor={`${n(total["pedidos"])} / ${brl(total["ticket"])}`}
            />
            <Indicador label="Comissões apuradas" valor={brl(total["comissao"])} />
          </section>
          {lucro && (
            <section className="rounded-xl border bg-card p-4 space-y-4">
              <div className="flex flex-wrap justify-between gap-3">
                <h2 className="font-semibold">Rentabilidade do período</h2>
                <select
                  aria-label="Considerar comissão no lucro"
                  className="rounded border bg-background p-2 text-sm"
                  value={comissao}
                  onChange={(e) => {
                    setComissao(e.target.value);
                    setPagina(0);
                  }}
                >
                  <option value="com">Com comissão</option>
                  <option value="sem">Sem comissão</option>
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Indicador
                  label={`Lucro bruto ${comissao === "com" ? "com" : "sem"} comissão`}
                  valor={brl(total[brutoKey])}
                  anterior={anterior[brutoKey]}
                  atual={total[brutoKey]}
                />
                <Indicador
                  label={`Lucro líquido estimado ${comissao === "com" ? "com" : "sem"} comissão`}
                  valor={brl(total[liquidoKey])}
                  anterior={anterior[liquidoKey]}
                  atual={total[liquidoKey]}
                />
                <Indicador
                  label="Margem líquida estimada"
                  valor={
                    n(total["vendas"])
                      ? percentual((n(total[liquidoKey]) / n(total["vendas"])) * 100)
                      : "—"
                  }
                />
                <Indicador label="Custo das mercadorias (CMV)" valor={brl(total["custo"])} />
              </div>
              {n(total["sem_custo"]) > 0 && (
                <p
                  role="status"
                  className="rounded border border-amber-300 p-3 text-sm text-amber-800"
                >
                  {n(total["sem_custo"])} itens sem custo informado. O lucro pode estar
                  superestimado; revise os custos antes de decidir.
                </p>
              )}
              {n(total["custo_atual"]) > 0 && (
                <p className="text-xs text-muted-foreground">
                  {n(total["custo_atual"])} itens usam o custo atual do cadastro por não possuírem
                  custo histórico salvo.
                </p>
              )}
            </section>
          )}
          <p className="text-xs text-muted-foreground">
            Comparação: {dataAgenda(dados.comparativo_inicio)} a {dataAgenda(dados.comparativo_fim)}
            , com os mesmos filtros. Os totais abrangem todo o período, independentemente da página.
          </p>
          <Tabs value={aba} onValueChange={setAba} className="space-y-4">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="visao">Visão geral</TabsTrigger>
              <TabsTrigger value="ranking">Rankings</TabsTrigger>
              <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
              <TabsTrigger value="produtos">Produtos e comissões</TabsTrigger>
              {canManage && perm.pode("indicadores_comparar") && (
                <TabsTrigger value="centros">Comparativo de centros</TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="visao" className="space-y-4">
              <section className="rounded-xl border bg-card p-4 space-y-3">
                <h2 className="font-semibold">Composição do resultado</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["Itens brutos", "bruto"],
                    ["Descontos", "descontos"],
                    ["Devoluções confirmadas", "devolucoes"],
                    ["Peso vendido (antes de devoluções)", "peso"],
                    ...(lucro
                      ? [
                          ["Custo do frete", "frete"],
                          ["Tributos estimados", "tributos"],
                          ["Despesas variáveis", "despesas"],
                          ["Lucro líquido sem comissão", "lucro_liquido_sem"],
                          ["Lucro líquido com comissão", "lucro_liquido_com"],
                        ]
                      : []),
                  ].map(([label, key]) => (
                    <Indicador
                      key={key}
                      label={label!}
                      valor={key === "peso" ? peso(total[key!]) : brl(total[key!])}
                    />
                  ))}
                </div>
              </section>
              {dados.mensal.length > 1 && (
                <section className="min-w-0 rounded-xl border bg-card p-4">
                  <h2 className="mb-4 font-semibold">Vendas e resultado por mês</h2>
                  <div
                    className="h-64 w-full"
                    role="img"
                    aria-label="Gráfico da evolução mensal; valores completos na tabela abaixo"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={dados.mensal}
                        margin={{ left: 8, right: 8, top: 8, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="mes" fontSize={11} />
                        <YAxis
                          width={72}
                          fontSize={11}
                          tickFormatter={(v) =>
                            Number(v).toLocaleString("pt-BR", { notation: "compact" })
                          }
                        />
                        <Tooltip formatter={(value) => brl(value)} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar
                          dataKey="vendas"
                          name="Vendas líquidas"
                          isAnimationActive={false}
                          fill="var(--primary)"
                          radius={[4, 4, 0, 0]}
                        />
                        {lucro && (
                          <Bar
                            dataKey={liquidoKey}
                            name={`Lucro estimado ${comissao === "com" ? "com" : "sem"} comissão`}
                            isAnimationActive={false}
                            fill="#0d9488"
                            radius={[4, 4, 0, 0]}
                          />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}
              <Tabela
                titulo="Evolução mensal"
                linhas={dados.mensal}
                colunas={[
                  { key: "mes", label: "Mês" },
                  { key: "pedidos", label: "Pedidos" },
                  { key: "vendas", label: "Vendas líquidas" },
                  { key: "comissao", label: "Comissão" },
                  ...(lucro
                    ? [
                        {
                          key: liquidoKey,
                          label: `Lucro líquido estimado ${comissao === "com" ? "com" : "sem"} comissão`,
                        },
                      ]
                    : []),
                ]}
              />
            </TabsContent>
            <TabsContent value="ranking" className="space-y-3">
              <div className="flex flex-wrap gap-3 rounded-xl border bg-card p-4">
                <label className="text-sm">
                  Agrupar por
                  <select
                    aria-label="Agrupar ranking por"
                    className="mt-1 block rounded border bg-background p-2"
                    value={grupo}
                    onChange={(e) => {
                      setGrupo(e.target.value);
                      setPagina(0);
                    }}
                  >
                    {GRUPOS_VENDAS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Ordenar por
                  <select
                    aria-label="Ordenar ranking por"
                    className="mt-1 block rounded border bg-background p-2"
                    value={ordem}
                    onChange={(e) => {
                      setOrdem(e.target.value);
                      setPagina(0);
                    }}
                  >
                    {[
                      { value: "vendas", label: "Vendas líquidas" },
                      { value: "pedidos", label: "Quantidade de pedidos" },
                      { value: "comissao", label: "Comissão" },
                      { value: "peso", label: "Peso" },
                      ...(lucro
                        ? [
                            { value: "lucro_bruto", label: "Lucro bruto" },
                            { value: "lucro_liquido", label: "Lucro líquido estimado" },
                            { value: "margem", label: "Margem estimada" },
                          ]
                        : []),
                    ].map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Ordem
                  <select
                    aria-label="Ordem do ranking"
                    className="mt-1 block rounded border bg-background p-2"
                    value={asc ? "asc" : "desc"}
                    onChange={(e) => {
                      setAsc(e.target.value === "asc");
                      setPagina(0);
                    }}
                  >
                    <option value="desc">Maior para menor</option>
                    <option value="asc">Menor para maior</option>
                  </select>
                </label>
              </div>
              <Tabela
                titulo="Ranking do período"
                linhas={ranking}
                colunas={colunasRanking}
                exportar
              />
              <Paginacao
                pagina={pagina}
                total={dados.grupos}
                carregando={consulta.isFetching}
                mudar={setPagina}
              />
            </TabsContent>
            <TabsContent value="pedidos" className="space-y-3">
              <Tabela
                titulo="Pedidos do período"
                linhas={dados.pedidos}
                colunas={colunasPedidos}
                exportar
              />
              <Paginacao
                pagina={paginaPedidos}
                total={n(total["pedidos"])}
                carregando={consulta.isFetching}
                mudar={setPaginaPedidos}
              />
            </TabsContent>
            <TabsContent value="produtos" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                20 maiores produtos e representantes no período filtrado. Produtos exibem
                quantidades e valor dos itens antes dos descontos gerais, frete e devoluções; não
                representam lucro por produto. Use Rankings para consultar todos os representantes.
              </p>
              <Tabela
                titulo="Produtos mais vendidos"
                linhas={dados.produtos}
                colunas={[
                  { key: "codigo", label: "Código" },
                  { key: "descricao", label: "Produto" },
                  { key: "quantidade", label: "Quantidade" },
                  { key: "total", label: "Valor dos itens" },
                ]}
                exportar
              />
              <Tabela
                titulo="Comissões por representante"
                linhas={dados.comissoes}
                colunas={[
                  { key: "representante", label: "Representante" },
                  { key: "comissao", label: "Apurada" },
                  { key: "a_pagar", label: "Prevista / liberada" },
                  { key: "paga", label: "Paga" },
                ]}
                exportar
              />
            </TabsContent>
            <TabsContent value="centros">
              <p className="mb-3 text-sm text-muted-foreground">
                Período escolhido e intervalo anterior com a mesma duração. Todos os filtros acima
                também se aplicam a esta comparação.
              </p>
              <Tabela
                titulo="Comparativo de períodos e centros"
                linhas={dados.comparativo ?? []}
                colunas={[
                  { key: "centro", label: "Centro" },
                  { key: "periodo", label: "Período" },
                  { key: "pedidos", label: "Pedidos" },
                  { key: "vendas", label: "Vendas líquidas" },
                  ...(lucro
                    ? [
                        {
                          key: liquidoKey,
                          label: `Lucro líquido estimado ${comissao === "com" ? "com" : "sem"} comissão`,
                        },
                      ]
                    : []),
                ]}
                exportar
              />
            </TabsContent>
          </Tabs>
          <details className="rounded-xl border bg-card p-4 text-sm">
            <summary className="cursor-pointer font-medium">Como os valores são calculados</summary>
            <div className="mt-3 space-y-2 text-muted-foreground">
              <p>
                Somente pedidos efetivados; rascunhos, aguardando aprovação, aprovados sem
                confirmação, recusados e cancelados ficam fora. O período usa a data do pedido, não
                a data de recebimento.
              </p>
              <p>
                Total vendido é o total líquido do pedido, que já inclui os descontos, acréscimos e
                o frete cobrado. Vendas líquidas deduzem as devoluções confirmadas vinculadas a
                esses pedidos, inclusive devoluções confirmadas posteriormente. O histórico pode
                mudar após uma devolução.
              </p>
              <p>
                Lucro bruto sem comissão = vendas líquidas − CMV. A opção com comissão também
                desconta a comissão. Lucro líquido estimado = lucro bruto − custo de frete −
                tributos estimados − despesas variáveis informados nos pedidos. A comissão é
                descontada uma única vez.
              </p>
              <p>
                O CMV usa o custo histórico do item; na ausência, usa custo médio, preço de custo ou
                último custo atual. Mercadorias devolvidas em condição de revenda revertem o CMV
                pelo custo médio dos itens do pedido; avarias não revertem o custo. Peso e ranking
                de produtos são anteriores às devoluções.
              </p>
              <p>
                Comissão considera os lançamentos não cancelados; sem lançamento, usa a comissão
                prevista no pedido. Comissões já pagas permanecem como custo até o tratamento do
                ajuste de devolução. Esta análise não deduz despesas fixas nem faz rateio automático
                de despesas de rota. Consulte a DRE para o resultado geral da empresa.
              </p>
            </div>
          </details>
          <p className="text-xs text-muted-foreground">
            Exportação e impressão das listas consideram a página exibida; indicadores e evolução
            mensal consideram todo o filtro.
          </p>
        </>
      )}
    </div>
  );
}
function Indicador({
  label,
  valor,
  atual,
  anterior,
}: {
  label: string;
  valor: string;
  atual?: unknown;
  anterior?: unknown;
}) {
  const variacao = atual === undefined ? undefined : variacaoVendas(atual, anterior);
  return (
    <article className="min-w-0 rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 break-words text-xl font-semibold tabular-nums">{valor}</p>
      {variacao !== undefined && (
        <p className="mt-1 text-xs text-muted-foreground">
          {variacao === null
            ? "Sem base no período anterior"
            : `${variacao > 0 ? "+" : ""}${percentual(variacao)} sobre o período anterior`}
        </p>
      )}
    </article>
  );
}
function Paginacao({
  pagina,
  total,
  carregando,
  mudar,
}: {
  pagina: number;
  total: number;
  carregando: boolean;
  mudar: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button
        variant="outline"
        size="sm"
        disabled={pagina === 0 || carregando}
        onClick={() => mudar(pagina - 1)}
      >
        Anterior
      </Button>
      <span>
        Página {pagina + 1} de {Math.max(1, Math.ceil(total / 50))} · {total} registros
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={(pagina + 1) * 50 >= total || carregando}
        onClick={() => mudar(pagina + 1)}
      >
        Próxima
      </Button>
    </div>
  );
}
function Tabela({
  titulo,
  linhas,
  colunas,
  exportar = false,
}: {
  titulo: string;
  linhas: Linha[];
  colunas: Coluna[];
  exportar?: boolean;
}) {
  return (
    <section className="min-w-0 rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <h2 className="font-semibold">{titulo}</h2>
        {exportar && (
          <Button
            className="no-print"
            variant="outline"
            size="sm"
            disabled={!linhas.length}
            onClick={() => exportarCsv(titulo, colunas, linhas)}
          >
            <Download className="size-4" /> Exportar página
          </Button>
        )}
      </div>
      {linhas.length ? (
        <div className="overflow-x-auto">
          <table className="mobile-cards w-full text-left text-sm">
            <caption className="sr-only">{titulo}</caption>
            <thead>
              <tr className="border-b bg-muted/30">
                {colunas.map((c) => (
                  <th scope="col" key={c.key} className="whitespace-nowrap p-3 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((r, i) => (
                <tr
                  key={String(
                    r["pedido_id"] ??
                      r["chave"] ??
                      r["produto_id"] ??
                      r["representante_id"] ??
                      r["mes"] ??
                      i,
                  )}
                  className="border-b last:border-0"
                >
                  {colunas.map((c) => (
                    <td
                      data-label={c.label}
                      key={c.key}
                      className={`p-3 ${dinheiro.has(c.key) ? "whitespace-nowrap tabular-nums" : ""}`}
                    >
                      {c.key === "numero" ? (
                        <ReferenciaRegistro tipo="pedido" id={r["pedido_id"]}>
                          {formatar(c.key, r[c.key])}
                        </ReferenciaRegistro>
                      ) : c.key === "cliente" ? (
                        <ReferenciaRegistro tipo="cliente" id={r["cliente_id"]}>
                          {formatar(c.key, r[c.key])}
                        </ReferenciaRegistro>
                      ) : c.key === "nome" ? (
                        <ReferenciaRegistro tipo="cliente" id={r["cliente_id"]}>
                          {formatar(c.key, r[c.key])}
                        </ReferenciaRegistro>
                      ) : c.key === "margem_exibida" ? (
                        percentual(r[c.key])
                      ) : (
                        formatar(c.key, r[c.key])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-6 text-sm text-muted-foreground">Sem dados neste filtro.</p>
      )}
    </section>
  );
}
