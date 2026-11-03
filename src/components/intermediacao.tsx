import { HistoricoIntermediacaoCliente } from "./historico-intermediacao-cliente";
import { useEffect, useState, useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "./ui/table";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { usePodeAlterarPreco } from "@/lib/papeis";
import { lerPaginas } from "@/lib/paginacao";
import { brl } from "@/lib/formatacao";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { calcularIntermediacao, dataBaseIntermediacao } from "@/lib/intermediacao";

type Row = Record<string, unknown>;
type Cotacao = {
  id: string;
  produto_id: string;
  dia: string;
  custo_fabrica: number;
  revisao: number;
  created_at: string;
};
function useCotacoes(loja: string, dia: string) {
  const { client, user } = useSupabase();
  return useQuery({
    queryKey: ["intermediacao-cotacoes", user?.id, loja, dia],
    enabled: !!client && !!loja && !!dia,
    queryFn: () =>
      lerPaginas<Cotacao>((a, b) =>
        client!.rpc("listar_cotacoes_vigentes_298", { _loja: loja, _ate: dia }).range(a, b),
      ),
  });
}
type EdicaoCotacao = { dia: string; custo: string; esperada: string | null; dataEditada: boolean };
const formatarCustoCotacao = (valor: number) =>
  valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
    useGrouping: false,
  });
function lerCustoCotacao(valor: string) {
  const texto = valor.trim().replace(/^R\$\s*/, "");
  if (/^\d+(?:\.\d{1,4})?$/.test(texto)) return Number(texto);
  if (/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,4}$/.test(texto))
    return Number(texto.replace(/\./g, "").replace(",", "."));
  return NaN;
}
export function CotacoesIntermediacao({
  loja,
  diaInicial = hojeSaoPaulo(),
  dataFixa = false,
}: {
  loja: string;
  diaInicial?: string;
  dataFixa?: boolean;
}) {
  const { client, canManage, user } = useSupabase(),
    qc = useQueryClient(),
    permissoes = usePermissoesRotinas();
  const podeCotar =
    usePodeAlterarPreco() || (canManage && permissoes.pode("configuracao_rotinas_editar"));
  const prefixo = useId();
  const [edicoes, setEdicoes] = useState<Record<string, EdicaoCotacao>>({}),
    [busca, setBusca] = useState(""),
    [historicoAberto, setHistoricoAberto] = useState(false);
  const acesso = useAcessoIntermediacao(loja);
  const cotacoes = useCotacoes(loja, diaInicial);
  const produtos = useQuery({
    queryKey: ["cotacoes-catalogo", user?.id, loja],
    enabled: !!client && !!loja,
    queryFn: () =>
      lerPaginas<Row>((a, b) =>
        client!
          .rpc("listar_catalogo_loja_244", { _loja: loja, _somente_disponiveis: true })
          .range(a, b),
      ),
  });
  const historico = useQuery({
    queryKey: ["intermediacao-cotacoes-historico", user?.id, loja, diaInicial],
    enabled: !!client && historicoAberto && acesso.data === true,
    queryFn: async () => {
      const r = await client!
        .from("intermediacao_cotacoes_296")
        .select("*")
        .eq("centro_id", loja)
        .lte("dia", diaInicial)
        .order("dia", { ascending: false })
        .order("revisao", { ascending: false })
        .limit(100);
      if (r.error) throw Error(r.error.message);
      return r.data as Cotacao[];
    },
  });
  const atualizar = () => {
    for (const key of [
      "intermediacao-cotacoes",
      "intermediacao-cotacoes-historico",
      "previa-modalidade",
    ])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  const salvar = useMutation({
    mutationFn: async ({ produto, edicao }: { produto: string; edicao: EdicaoCotacao }) => {
      const r = await client!.rpc("salvar_cotacao_lista_309", {
        _loja: loja,
        _produto: produto,
        _dia: edicao.dia,
        _custo: lerCustoCotacao(edicao.custo),
        _ate: dataFixa ? diaInicial : edicao.dia > diaInicial ? edicao.dia : diaInicial,
        _esperada: edicao.esperada,
      });
      if (r.error) throw Error(r.error.message);
      const cotacao = (Array.isArray(r.data) ? r.data[0] : r.data) as Cotacao | null;
      if (!cotacao?.id || !cotacao.dia)
        throw Error(
          "Não foi possível confirmar a cotação salva. Atualize a lista antes de tentar novamente.",
        );
      return { produto, cotacao };
    },
    onSuccess: ({ produto, cotacao }) => {
      if (cotacao.dia <= diaInicial)
        qc.setQueryData<Cotacao[]>(
          ["intermediacao-cotacoes", user?.id, loja, diaInicial],
          (atuais) => [...(atuais ?? []).filter((c) => c.produto_id !== produto), cotacao],
        );
      setEdicoes((atual) => {
        const novas = { ...atual };
        delete novas[produto];
        return novas;
      });
      atualizar();
      toast.success("Cotação salva. Pedidos anteriores mantêm o custo gravado.");
    },
    onError: (e: Error) => {
      atualizar();
      toast.error(e.message);
    },
  });
  const ultimas = cotacoes.data ?? [];
  const nome = (id: string) =>
    String(produtos.data?.find((p) => p["id"] === id)?.["descricao"] ?? id);
  const lista = (produtos.data ?? []).filter((p) =>
    `${p["codigo"] ?? ""} ${p["descricao"] ?? ""}`
      .toLocaleLowerCase("pt-BR")
      .includes(busca.trim().toLocaleLowerCase("pt-BR")),
  );
  const cotacaoPorProduto = new Map(ultimas.map((c) => [c.produto_id, c]));
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <div>
        <h3 className="font-semibold">Cotação de fábrica • Intermediação</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Altere o valor ou a data na linha do produto e clique em Salvar. Ao mudar o valor,
          sugerimos a data base do pedido. Pedidos já lançados mantêm o custo gravado.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Preços vigentes até {dataBr(diaInicial)}. O último preço continua válido até uma nova
          cotação.
        </p>
      </div>
      <div className="max-w-md space-y-1">
        <Label htmlFor={`${prefixo}-busca`}>Buscar produto na lista</Label>
        <Input
          id={`${prefixo}-busca`}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Código ou nome do produto"
        />
      </div>
      {(cotacoes.error || produtos.error || acesso.error) && (
        <p role="alert" className="text-sm text-destructive">
          {(cotacoes.error ?? produtos.error ?? acesso.error)?.message}
        </p>
      )}
      {cotacoes.isPending || produtos.isPending ? (
        <p className="text-sm">Carregando produtos e cotações…</p>
      ) : (
        <>
          <Table className="mobile-cards">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]">Produto</TableHead>
                <TableHead data-column-key="Fábrica / saca" className="min-w-[170px]">
                  Fábrica / saco (R$)
                </TableHead>
                <TableHead data-column-key="Data do último preço" className="min-w-[170px]">
                  Data da cotação
                </TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((p) => {
                const id = String(p["id"]),
                  c = cotacaoPorProduto.get(id),
                  padrao: EdicaoCotacao = {
                    dia: c?.dia ?? diaInicial,
                    custo: c ? formatarCustoCotacao(Number(c.custo_fabrica)) : "",
                    esperada: c?.id ?? null,
                    dataEditada: false,
                  },
                  e = edicoes[id] ?? padrao,
                  valor = lerCustoCotacao(e.custo),
                  mudou =
                    !!edicoes[id] && (!c || valor !== Number(c.custo_fabrica) || e.dia !== c.dia),
                  enviando = salvar.isPending && salvar.variables?.produto === id,
                  liberado = podeCotar && acesso.data === true && !enviando,
                  valido =
                    Number.isFinite(valor) &&
                    valor > 0 &&
                    valor < 10000000000 &&
                    !!e.dia &&
                    (!c || e.dia >= c.dia) &&
                    (!dataFixa || e.dia <= diaInicial);
                return (
                  <TableRow key={id} className={mudou ? "bg-primary/5" : undefined}>
                    <TableCell data-label="Produto">
                      <p className="font-medium">{String(p["descricao"])}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {p["codigo"] ? `${p["codigo"]} · ` : ""}
                        {c
                          ? `Último preço: ${dataBr(c.dia)} · ${brl(c.custo_fabrica)}`
                          : "Sem cotação cadastrada"}
                      </p>
                    </TableCell>
                    <TableCell data-label="Fábrica / saco (R$)">
                      <Input
                        aria-label={`Custo fábrica por saco de ${String(p["descricao"])}`}
                        inputMode="decimal"
                        value={e.custo}
                        disabled={!liberado}
                        placeholder="0,00"
                        className="w-full sm:max-w-44"
                        onChange={(event) => {
                          const custo = event.target.value;
                          setEdicoes((antes) => {
                            const base = antes[id] ?? padrao;
                            return {
                              ...antes,
                              [id]: {
                                ...base,
                                custo,
                                dia: base.dataEditada ? base.dia : diaInicial,
                              },
                            };
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell data-label="Data da cotação">
                      <Input
                        aria-label={`Data da cotação de ${String(p["descricao"])}`}
                        type="date"
                        value={e.dia}
                        min={c?.dia}
                        max={dataFixa ? diaInicial : undefined}
                        disabled={!liberado}
                        className="w-full sm:max-w-44"
                        onChange={(event) => {
                          const dia = event.target.value;
                          setEdicoes((antes) => ({
                            ...antes,
                            [id]: { ...(antes[id] ?? padrao), dia, dataEditada: true },
                          }));
                        }}
                      />
                    </TableCell>
                    <TableCell data-label="Ações">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={!liberado || salvar.isPending || !mudou || !valido}
                          onClick={() => salvar.mutate({ produto: id, edicao: e })}
                        >
                          {enviando ? "Salvando…" : "Salvar"}
                        </Button>
                        {edicoes[id] && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={enviando}
                            onClick={() =>
                              setEdicoes((antes) => {
                                const novas = { ...antes };
                                delete novas[id];
                                return novas;
                              })
                            }
                          >
                            Descartar
                          </Button>
                        )}
                      </div>
                      {mudou && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {valido ? "Alteração pendente" : "Confira o valor e a data informados."}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!lista.length && (
            <p className="p-2 text-sm text-muted-foreground">
              {busca
                ? "Nenhum produto encontrado."
                : "Nenhum produto disponível no catálogo desta loja."}
            </p>
          )}
        </>
      )}
      {!podeCotar && (
        <p className="text-xs text-muted-foreground">
          Seu perfil permite apenas consultar as cotações.
        </p>
      )}
      {ultimas.length > 0 && (
        <details className="text-xs" onToggle={(e) => setHistoricoAberto(e.currentTarget.open)}>
          <summary>Histórico de preços e revisões (últimos 100)</summary>
          {historico.error && <p role="alert">{historico.error.message}</p>}
          <ul className="mt-2 space-y-1">
            {(historico.data ?? []).map((c) => (
              <li key={c.id}>
                {nome(c.produto_id)} · preço de {dataBr(c.dia)} · revisão {c.revisao} ·{" "}
                {brl(c.custo_fabrica)} · {new Date(c.created_at).toLocaleString("pt-BR")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
const dataBr = (dia: string) => dia?.split("-").reverse().join("/");
function useAcessoIntermediacao(loja: string, habilitada = false) {
  const { client, user } = useSupabase();
  return useQuery({
    queryKey: [habilitada ? "intermediacao-ativa" : "intermediacao-vendedor", user?.id, loja],
    enabled: !!client && !!loja,
    queryFn: async () => {
      const r = await client!.rpc(
        habilitada ? "intermediacao_ativa_296" : "vendedor_intermediacao_autorizado_298",
        { _loja: loja },
      );
      if (r.error) throw Error(r.error.message);
      return r.data === true;
    },
  });
}
export function ModalidadeInicial({
  loja,
  value,
  onChange,
}: {
  loja: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const q = useAcessoIntermediacao(loja, true);
  return (
    <div className="space-y-1">
      <Label htmlFor="modalidade-inicial">Modalidade da venda</Label>
      <select
        id="modalidade-inicial"
        className="h-11 w-full rounded-md border bg-background px-3"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="estoque">Vendas Estoque</option>
        <option value="intermediacao" disabled={!q.data}>
          Vendas Intermediação
        </option>
      </select>
      <p className="text-xs text-muted-foreground">
        Novos documentos começam com venda do estoque. A intermediação exige habilitação da loja e
        autorização do vendedor.
      </p>
      {q.error && (
        <p role="alert" className="text-xs text-destructive">
          {q.error.message}
        </p>
      )}
    </div>
  );
}
type PreviaItem = {
  id: string;
  produto: string;
  quantidade: number;
  preco_anterior: number;
  total_anterior: number;
  cotacao: string | null;
  data_preco: string;
  fabrica: number;
  frete: number;
  margem: number;
};
type Previa = { versao: string; itens: PreviaItem[] };
function TrocaModalidade({
  doc,
  modalidade,
  onClose,
  onChange,
}: {
  doc: Row;
  modalidade: string;
  onClose: () => void;
  onChange: () => void;
}) {
  const { client, user } = useSupabase();
  const [valores, setValores] = useState<Record<string, { frete: string; margem: string }>>({});
  const [mostrarCotas, setMostrarCotas] = useState(false);
  const q = useQuery({
    queryKey: ["previa-modalidade", user?.id, doc["id"], modalidade],
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const r = await client!.rpc("previa_modalidade_298", {
        _pedido: doc["id"],
        _modalidade: modalidade,
      });
      if (r.error) throw Error(r.error.message);
      return r.data as Previa;
    },
  });
  useEffect(() => {
    if (q.data)
      setValores(
        Object.fromEntries(
          q.data.itens.map((i) => [
            i.id,
            { frete: String(i.frete ?? 0), margem: String(i.margem ?? 0) },
          ]),
        ),
      );
  }, [q.data]);
  const inter = modalidade === "intermediacao";
  const calculo = (i: PreviaItem) =>
    calcularIntermediacao({
      quantidade: Number(i.quantidade),
      fabrica: Number(i.fabrica),
      frete: Number(valores[i.id]?.frete),
      margem: Number(valores[i.id]?.margem),
    });
  const invalido = !q.data || (inter && q.data.itens.some((i) => !i.cotacao || !calculo(i)));
  const salvar = useMutation({
    mutationFn: async () => {
      const r = await client!.rpc("trocar_modalidade_298", {
        _pedido: doc["id"],
        _modalidade: modalidade,
        _versao: q.data!.versao,
        _itens: inter
          ? q.data!.itens.map((i) => ({
              id: i.id,
              cotacao: i.cotacao,
              frete: Number(valores[i.id]?.frete),
              margem: Number(valores[i.id]?.margem),
            }))
          : [],
      });
      if (r.error) throw Error(r.error.message);
    },
    onSuccess: () => {
      onChange();
      onClose();
      toast.success("Modalidade e itens atualizados.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !salvar.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Revisar mudança de modalidade</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          {inter
            ? "Confira fábrica, frete e margem por saco. A sugestão mantém o preço líquido atual quando ele cobre o custo da fábrica; ajuste a margem se necessário. Descontos dos itens serão incorporados ao preço."
            : "Os preços negociados serão preservados; o custo e a movimentação voltarão a seguir o estoque da loja após a aprovação."}
        </p>
        {q.error && (
          <p role="alert" className="text-destructive">
            {q.error.message}
          </p>
        )}
        {q.isFetching && <p>Conferindo itens e preços…</p>}
        <div className="space-y-3">
          {q.data?.itens.map((i) => (
            <div key={i.id} className="rounded-lg border p-3 space-y-2">
              <p className="font-medium">
                {i.produto} · {i.quantidade} unidades
              </p>
              <p className="text-sm">Total atual: {brl(i.total_anterior)}</p>
              {inter && (
                <>
                  <p className="text-sm">
                    {i.cotacao
                      ? `Fábrica: ${brl(i.fabrica)} / saco · último preço: ${dataBr(i.data_preco)}`
                      : "Sem cotação vigente. Cadastre um preço e atualize a prévia."}
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(["frete", "margem"] as const).map((c) => (
                      <div key={c}>
                        <Label htmlFor={`previa-${c}-${i.id}`}>
                          {c === "frete" ? "Frete" : "Margem"} / saco (R$)
                        </Label>
                        <Input
                          id={`previa-${c}-${i.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          value={valores[i.id]?.[c] ?? ""}
                          onChange={(e) =>
                            setValores((v) => ({
                              ...v,
                              [i.id]: { ...v[i.id]!, [c]: e.target.value },
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-sm">
                    {calculo(i)
                      ? `Novo total: ${brl(calculo(i)!.total)}`
                      : "Informe quantidade inteira e valores válidos, sem frete ou margem negativos."}
                  </p>
                </>
              )}
            </div>
          ))}
        </div>
        {inter && (
          <>
            <Button variant="outline" onClick={() => setMostrarCotas((v) => !v)}>
              Cotações de fábrica
            </Button>
            {mostrarCotas && (
              <CotacoesIntermediacao
                key={`${doc["id"]}-${doc["centro_id"]}-${dataBaseIntermediacao(doc)}`}
                loja={String(doc["centro_id"])}
                diaInicial={dataBaseIntermediacao(doc)}
                dataFixa
              />
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2 justify-end">
          <Button
            variant="outline"
            disabled={salvar.isPending || q.isFetching}
            onClick={() => void q.refetch()}
          >
            Atualizar prévia
          </Button>
          <Button variant="outline" disabled={salvar.isPending} onClick={onClose}>
            Voltar
          </Button>
          <Button
            disabled={invalido || q.isFetching || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            Confirmar modalidade
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function ModalidadePedido({
  doc,
  temItens,
  onChange,
  editavel = true,
  pendente = false,
  carregando = false,
}: {
  doc: Row;
  temItens: boolean;
  onChange: () => void;
  editavel?: boolean;
  pendente?: boolean;
  carregando?: boolean;
}) {
  const { client } = useSupabase(),
    qc = useQueryClient();
  const [cotas, setCotas] = useState(false),
    [troca, setTroca] = useState("");
  const q = useAcessoIntermediacao(String(doc["centro_id"]), true);
  const acesso = useAcessoIntermediacao(String(doc["centro_id"]));
  const inter = doc["modalidade_venda"] === "intermediacao",
    orcamento = doc["tipo_documento"] === "orcamento";
  const editar =
    editavel &&
    ["rascunho", "digitacao"].includes(String(doc["status"])) &&
    (!inter || acesso.data === true);
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["pedido_itens"] });
    void qc.invalidateQueries({ queryKey: ["vw_margem_pedido_209"] });
    void qc.invalidateQueries({ queryKey: ["validar_pedido"] });
    onChange();
  };
  const mudar = useMutation({
    mutationFn: async (modalidade: string) => {
      const r = await client!.rpc("definir_modalidade_pedido_296", {
        _pedido: doc["id"],
        _modalidade: modalidade,
      });
      if (r.error) throw Error(r.error.message);
    },
    onSuccess: atualizar,
    onError: (e: Error) => toast.error(e.message),
  });
  const frete = useMutation({
    mutationFn: async (v: string) => {
      const r = await client!.rpc("definir_responsavel_frete_298", {
        _pedido: doc["id"],
        _responsavel: v || null,
      });
      if (r.error) throw Error(r.error.message);
    },
    onSuccess: () => {
      onChange();
      toast.success("Responsável pelo frete salvo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  useEffect(() => {
    if (orcamento && inter && editar) setCotas(true);
  }, [orcamento, inter, editar]);
  if (!q.data && !inter)
    return q.error ? (
      <p role="alert" className="text-destructive">
        {q.error.message}
      </p>
    ) : null;
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full min-w-0 space-y-1 sm:w-auto">
          <Label htmlFor={`modalidade-${doc["id"]}`}>
            {orcamento ? "Modalidade do orçamento" : "Modalidade da venda"}
          </Label>
          <select
            id={`modalidade-${doc["id"]}`}
            className="block h-11 w-full max-w-full rounded-md border bg-background px-3"
            disabled={!editar || pendente || carregando || mudar.isPending}
            value={inter ? "intermediacao" : "estoque"}
            onChange={(e) => (temItens ? setTroca(e.target.value) : mudar.mutate(e.target.value))}
          >
            <option value="estoque">Vendas Estoque</option>
            <option value="intermediacao" disabled={!q.data}>
              Vendas Intermediação
            </option>
          </select>
        </div>
        {q.data && editar && inter && (
          <Button variant="outline" onClick={() => setCotas((v) => !v)}>
            {cotas ? "Fechar cotações" : "Cotações de fábrica"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {inter
          ? "Fábrica + frete + margem por saco, sem margem mínima configurada e sem movimentar estoque da loja. A cobrança é integral; carga e entrega seguem o fluxo usual."
          : "Venda com estoque da loja. É possível revisar a modalidade durante a digitação; documentos com itens exigem conferência da prévia."}
      </p>
      {inter && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-1 sm:w-52">
              <Label htmlFor={`frete-pagador-${doc["id"]}`}>Quem paga o frete</Label>
              <select
                id={`frete-pagador-${doc["id"]}`}
                className="block h-11 w-full rounded-md border bg-background px-3"
                value={String(doc["responsavel_frete_intermediacao"] ?? "")}
                disabled={!editar || frete.isPending}
                onChange={(e) => frete.mutate(e.target.value)}
              >
                <option value="">Não informado</option>
                <option value="loja">Loja vendedora</option>
                <option value="cliente">Cliente</option>
              </select>
            </div>
            <HistoricoIntermediacaoCliente
              key={`${doc["id"]}-${doc["cliente_id"]}-${doc["centro_id"]}`}
              doc={doc}
              autorizado={acesso.data === true}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Informação para a operação. Não altera o preço, o custo nem a cobrança do pedido.
          </p>
        </div>
      )}
      {cotas && editar && inter && q.data && (
        <CotacoesIntermediacao
          key={`${doc["id"]}-${doc["centro_id"]}-${dataBaseIntermediacao(doc)}`}
          loja={String(doc["centro_id"])}
          diaInicial={dataBaseIntermediacao(doc)}
          dataFixa
        />
      )}
      {troca && (
        <TrocaModalidade
          doc={doc}
          modalidade={troca}
          onClose={() => setTroca("")}
          onChange={atualizar}
        />
      )}
    </section>
  );
}
const vazio = {
  id: "",
  produto: "",
  quantidade: "1",
  frete: "0",
  margem: "0",
  cotacao: "",
  fabrica: 0,
};
export function ItensIntermediacao({
  doc,
  itens,
  produtos,
  carregando,
  onChange,
  onPendente,
  propostaEditavel = true,
}: {
  doc: Row;
  propostaEditavel?: boolean;
  itens: Row[];
  produtos: Row[];
  carregando: boolean;
  onChange: () => void;
  onPendente: (v: boolean) => void;
}) {
  const { client } = useSupabase(),
    qc = useQueryClient(),
    podePreco = usePodeAlterarPreco();
  const acesso = useAcessoIntermediacao(String(doc["centro_id"]));
  const cotacoes = useCotacoes(String(doc["centro_id"]), dataBaseIntermediacao(doc));
  const [form, setForm] = useState({ ...vazio });
  useEffect(() => {
    if (!form.produto || form.id || form.cotacao) return;
    const c = cotacoes.data?.find((c) => c.produto_id === form.produto);
    if (c)
      setForm((s) =>
        s.produto === c.produto_id && !s.id && !s.cotacao
          ? { ...s, cotacao: c.id, fabrica: Number(c.custo_fabrica) }
          : s,
      );
  }, [cotacoes.data, form.produto, form.id, form.cotacao]);

  const editavel =
    propostaEditavel &&
    acesso.data === true &&
    ["rascunho", "digitacao"].includes(String(doc["status"]));
  const nome = (id: unknown) => String(produtos.find((p) => p["id"] === id)?.["descricao"] ?? id);
  const atual = (id: string) => (cotacoes.data ?? []).find((c) => c.produto_id === id);
  const conferir = () => {
    void qc.invalidateQueries({ queryKey: ["pedido_itens"] });
    void qc.invalidateQueries({ queryKey: ["vw_margem_pedido_209"] });
    void qc.invalidateQueries({ queryKey: ["validar_pedido"] });
    onChange();
  };
  const salvar = useMutation({
    mutationFn: async () => {
      if (!calculo || !form.cotacao) throw Error("Informe cotação, sacos, frete e margem válidos.");
      const r = await client!.rpc("salvar_item_intermediacao_296", {
        _pedido: String(doc["id"]),
        _item: form.id || null,
        _produto: form.produto,
        _quantidade: Number(form.quantidade),
        _cotacao: form.cotacao,
        _frete: Number(form.frete),
        _margem: Number(form.margem),
      });
      if (r.error) throw Error(r.error.message);
    },
    onSuccess: () => {
      setForm({ ...vazio });
      conferir();
      toast.success("Item salvo com os custos desta cotação.");
    },
    onError: (e: Error) => {
      toast.error(e.message);
      void qc.invalidateQueries({ queryKey: ["intermediacao-cotacoes"] });
    },
  });
  const remover = useMutation({
    mutationFn: async (id: string) => {
      const r = await client!.rpc("remover_item_pedido", { _item_id: id });
      if (r.error) throw Error(r.error.message);
    },
    onSuccess: conferir,
    onError: (e: Error) => toast.error(e.message),
  });
  const pendente = !!form.produto || salvar.isPending || remover.isPending;
  useEffect(() => {
    onPendente(pendente);
    return () => onPendente(false);
  }, [pendente, onPendente]);
  const calculo = calcularIntermediacao({
    quantidade: Number(form.quantidade),
    fabrica: form.fabrica,
    frete: Number(form.frete),
    margem: Number(form.margem),
  });
  const total = itens.reduce(
    (s, i) => s + Number(i["quantidade"]) * Number(i["margem_saca"] ?? 0),
    0,
  );
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <div>
        <h3 className="font-semibold">Itens de intermediação</h3>
        <p className="text-xs text-muted-foreground">
          Data base da cotação: {dataBaseIntermediacao(doc).split("-").reverse().join("/")}. A
          margem é um valor em reais por saco.
        </p>
      </div>
      {editavel && podePreco && (
        <div
          role="group"
          aria-label={
            form.id ? "Edição de item de intermediação" : "Inclusão de item de intermediação"
          }
          className="@container space-y-3 rounded-lg border bg-muted/30 p-3"
        >
          <div className="grid grid-cols-2 items-end gap-2 @min-[600px]:grid-cols-4 @min-[900px]:grid-cols-[minmax(180px,2.2fr)_minmax(64px,.65fr)_minmax(90px,.9fr)_minmax(80px,.8fr)_minmax(84px,.85fr)_minmax(96px,.95fr)_minmax(110px,1.1fr)_minmax(108px,1.1fr)]">
            <div className="col-span-2 min-w-0 space-y-1 @min-[900px]:col-span-1">
              <Label htmlFor="inter-produto" className="text-xs">
                Cimento / produto
              </Label>
              <select
                id="inter-produto"
                className="h-11 w-full min-w-0 max-w-full rounded-md border bg-background px-2 text-sm"
                title={form.produto ? nome(form.produto) : "Selecione o produto"}
                value={form.produto}
                disabled={!!form.id}
                onChange={(e) => {
                  const c = atual(e.target.value);
                  setForm({
                    ...vazio,
                    produto: e.target.value,
                    cotacao: c?.id ?? "",
                    fabrica: Number(c?.custo_fabrica ?? 0),
                  });
                }}
              >
                <option value="">Selecione</option>
                {produtos.map((p) => (
                  <option key={String(p["id"])} value={String(p["id"])}>
                    {String(p["codigo"] ?? "")} · {String(p["descricao"])}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="inter-qtd" className="text-xs">
                Sacos
              </Label>
              <Input
                id="inter-qtd"
                aria-label="Quantidade de sacos"
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                className="h-11 min-w-0 text-right"
                value={form.quantidade}
                onChange={(e) => setForm((s) => ({ ...s, quantidade: e.target.value }))}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="inter-fabrica" className="text-xs">
                Fábrica / saco
              </Label>
              <output
                id="inter-fabrica"
                aria-label="Custo de fábrica por saco"
                className="flex h-11 min-w-0 items-center justify-end overflow-x-auto whitespace-nowrap rounded-md border bg-muted/40 px-2 text-xs font-semibold tabular-nums"
              >
                {form.cotacao ? brl(form.fabrica) : form.produto ? "Sem cotação" : "—"}
              </output>
            </div>
            {(["frete", "margem"] as const).map((k) => (
              <div key={k} className="min-w-0 space-y-1">
                <Label htmlFor={"inter-" + k} className="text-xs">
                  {k === "frete" ? "Frete / saco" : "Margem / saco"}
                </Label>
                <Input
                  id={"inter-" + k}
                  aria-label={k === "frete" ? "Frete por saco (R$)" : "Margem por saco (R$)"}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  className="h-11 min-w-0 text-right"
                  value={form[k]}
                  onChange={(e) => setForm((s) => ({ ...s, [k]: e.target.value }))}
                />
              </div>
            ))}
            <div className="min-w-0 space-y-1">
              <Label htmlFor="inter-preco" className="text-xs">
                Preço / saco
              </Label>
              <output
                id="inter-preco"
                aria-label="Preço final por saco"
                className="flex h-11 min-w-0 items-center justify-end overflow-x-auto whitespace-nowrap rounded-md border bg-primary/5 px-2 text-xs font-semibold tabular-nums text-primary"
              >
                {calculo ? brl(calculo.precoSaca) : "—"}
              </output>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="inter-total" className="text-xs">
                Total do item
              </Label>
              <output
                id="inter-total"
                aria-label="Total do item"
                className="flex h-11 min-w-0 items-center justify-end overflow-x-auto whitespace-nowrap rounded-md border bg-primary/5 px-2 text-xs font-semibold tabular-nums text-primary"
              >
                {calculo ? brl(calculo.total) : "—"}
              </output>
            </div>
            <div className="col-span-2 min-w-0 space-y-1 @min-[900px]:col-span-1">
              <span className="hidden text-xs font-medium @min-[900px]:block">Ação</span>
              <Button
                className="h-11 w-full px-2 text-xs"
                disabled={
                  !calculo ||
                  !form.cotacao ||
                  salvar.isPending ||
                  cotacoes.isPending ||
                  cotacoes.isError
                }
                onClick={() => salvar.mutate()}
              >
                {form.id ? "Salvar item" : "Adicionar item"}
              </Button>
            </div>
          </div>
          {(calculo || form.produto) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              {calculo && (
                <p className="text-xs text-muted-foreground">
                  Custo do item:{" "}
                  <strong className="text-foreground">{brl(calculo.custoTotal)}</strong> · Margem do
                  item: <strong className="text-foreground">{brl(calculo.margemTotal)}</strong>
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {form.produto &&
                  atual(form.produto)?.id !== form.cotacao &&
                  atual(form.produto) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const c = atual(form.produto)!;
                        setForm((s) => ({ ...s, cotacao: c.id, fabrica: Number(c.custo_fabrica) }));
                      }}
                    >
                      Aplicar cotação atual: {brl(atual(form.produto)?.custo_fabrica)}
                    </Button>
                  )}
                {form.produto && (
                  <Button size="sm" variant="outline" onClick={() => setForm({ ...vazio })}>
                    Descartar edição
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {editavel && !podePreco && (
        <p className="text-sm text-muted-foreground">
          Seu perfil não permite definir o preço dos itens de intermediação.
        </p>
      )}
      {cotacoes.error && (
        <p role="alert" className="text-sm text-destructive">
          {cotacoes.error.message}
        </p>
      )}
      {carregando ? (
        <p>Carregando itens…</p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="mobile-cards">
            <TableHeader>
              <TableRow>
                {[
                  "Produto",
                  "Sacos",
                  "Fábrica / saco",
                  "Frete / saco",
                  "Margem / saco",
                  "Preço / saco",
                  "Total",
                  "Ações",
                ].map((t) => (
                  <TableHead
                    key={t}
                    data-column-key={t.replace(/saco/g, "saca").replace(/Saco/g, "Saca")}
                  >
                    {t}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((i) => (
                <TableRow key={String(i["id"])}>
                  <TableCell data-label="Produto">{nome(i["produto_id"])}</TableCell>
                  <TableCell data-label="Sacos">{String(i["quantidade"])}</TableCell>
                  {(
                    [
                      "custo_fabrica_saca",
                      "frete_saca",
                      "margem_saca",
                      "preco_unitario",
                      "total",
                    ] as const
                  ).map((k, index) => (
                    <TableCell
                      key={k}
                      data-label={
                        [
                          "Fábrica / saco",
                          "Frete / saco",
                          "Margem / saco",
                          "Preço / saco",
                          "Total",
                        ][index]
                      }
                      className="whitespace-nowrap"
                    >
                      {brl(i[k])}
                    </TableCell>
                  ))}
                  <TableCell data-label="Ações">
                    {editavel && podePreco && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={salvar.isPending}
                          onClick={() =>
                            setForm({
                              id: String(i["id"]),
                              produto: String(i["produto_id"]),
                              quantidade: String(i["quantidade"]),
                              cotacao: String(i["cotacao_intermediacao_id"]),
                              fabrica: Number(i["custo_fabrica_saca"]),
                              frete: String(i["frete_saca"]),
                              margem: String(i["margem_saca"]),
                            })
                          }
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remover.isPending}
                          onClick={() => remover.mutate(String(i["id"]))}
                        >
                          Remover
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-sm font-semibold">Margem dos itens: {brl(total)}</p>
      <p className="text-xs text-muted-foreground">
        Fábrica e frete são custo, não lucro. Descontos, encargos de pagamento e comissões aparecem
        separadamente no fechamento.
      </p>
    </section>
  );
}
