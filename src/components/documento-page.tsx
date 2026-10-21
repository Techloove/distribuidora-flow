import { EncargosPedido } from "@/components/encargos-pedido";
import { OrcamentoPedido } from "@/components/orcamento-pedido";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { useAcompanhamentoPedido } from "@/lib/use-acompanhamento-pedido";
import { AcompanhamentoPedido } from "@/components/acompanhamento-pedido";
import { nomeStatusPedido, ordemStatusPedido, statusVisivelPedido } from "@/lib/status-pedido";
import { lerPaginas } from "@/lib/paginacao";
import { SelecionarPedidosLote } from "@/components/logistica-pratica";
import { MargemPedido } from "@/components/rotinas-distribuidora";
import { ResumoPedido } from "@/components/resumo-pedido";
import { conferirPedido, hojeSaoPaulo, type PedidoConferencia } from "@/lib/painel-trabalho";
import { ProgressoDescontoPeso } from "@/components/progresso-desconto-peso";
import { EmitirBoletosPedido } from "@/components/emitir-boletos-pedido";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ImprimirPedidos } from "@/components/imprimir-pedidos";
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
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { useCentro } from "@/lib/centro-store";
import { usePodeAlterarPreco } from "@/lib/papeis";
import { useSupabase } from "@/lib/supabase-provider";

import { brl } from "@/lib/formatacao";
import { deslocarDataISO } from "@/lib/integridade-consultas";
export { brl } from "@/lib/formatacao";

type Row = Record<string, unknown>;

export type DocumentoConfig = {
  /** pedidos | compras */
  table: "pedidos" | "compras";
  itemsTable: "pedido_itens" | "compra_itens";
  parentKey: "pedido_id" | "compra_id";
  /** coluna de preço do item */
  itemPriceField: "preco_unitario" | "custo_unitario";
  itemPriceLabel: string;
  /** parceiro (cliente ou fornecedor) */
  partnerTable: "clientes" | "fornecedores";
  partnerKey: "cliente_id" | "fornecedor_id";
  partnerLabel: string;
  dateField: "data_pedido" | "data_entrada";
  dateLabel: string;
  /** ação de efetivação */
  rpc: "confirmar_pedido" | "receber_compra";
  rpcLabel: string;
  doneStatus: string;
};

const emptyItem = {
  produto_id: "",
  quantidade: "1",
  preco: "0",
  desconto: "0",
  lote: "",
  validade: "",
};

export function DocumentoPage({
  config,
  initialDocId = null,
}: {
  config: DocumentoConfig;
  initialDocId?: string | null;
}) {
  const { client, roles, user } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const atualizarDocumento = () => {
    void queryClient.invalidateQueries({ queryKey: [config.table] });
    if (config.table === "pedidos")
      void queryClient.invalidateQueries({ queryKey: ["acompanhamento_pedido_235"] });
  };
  const [encargosPendentes, setEncargosPendentes] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialDocId);
  const [openNew, setOpenNew] = useState(false);
  const [header, setHeader] = useState<Record<string, string>>({});
  const [item, setItem] = useState({ ...emptyItem });
  const consultaPreco = useRef(0);
  const [consultandoPreco, setConsultandoPreco] = useState(false);
  useEffect(() => {
    consultaPreco.current++;
    setItem({ ...emptyItem });
    setPromo(null);
    setConsultandoPreco(false);
  }, [selected]);
  const [promo, setPromo] = useState<{
    preco: number;
    nome: string;
    fim: string | null;
  } | null>(null);

  const canWrite = roles.length > 0;
  const permissoes = usePermissoesRotinas();
  /** Permissão por papel para alterar o preço unitário dos itens. */
  const podeAlterarPreco = usePodeAlterarPreco();

  const docs = useQuery({
    queryKey: [config.table, user?.id, roles.slice().sort().join(",")],
    refetchInterval: config.table === "pedidos" ? 30_000 : false,
    enabled: !!client,
    queryFn: async () => {
      return lerPaginas<Row>((inicio, fim) =>
        client!
          .from(config.table)
          .select("*")
          .order("numero", { ascending: false })
          .order("id")
          .range(inicio, fim),
      );
    },
  });

  const partners = useQuery({
    queryKey: [
      config.partnerTable,
      "options",
      config.table,
      user?.id,
      roles.slice().sort().join(","),
    ],
    enabled: !!client,
    queryFn: async () => {
      const columns =
        config.partnerTable === "clientes"
          ? "id, razao_social, rota_id, centro_id, condicao_pagamento, limite_credito, representante_id"
          : "id, razao_social";
      const { data, error } = await client!
        .from(config.partnerTable)
        .select(columns)
        .order("razao_social");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Row[];
    },
  });

  const produtos = useQuery({
    queryKey: ["produtos", "options", "documentos"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("produtos")
        .select("id, codigo, descricao, preco_venda, custo_medio, estoque_atual, peso_kg")
        .order("descricao");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  /** Quantidades já compradas (NF de entrada pendente de recebimento). */
  const comprados = useQuery({
    queryKey: ["vw_produto_comprado"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_produto_comprado")
        .select("produto_id, quantidade_comprada");
      if (error) throw new Error(error.message);
      const mapa = new Map<string, number>();
      for (const r of (data ?? []) as Row[]) {
        mapa.set(String(r["produto_id"]), Number(r["quantidade_comprada"] ?? 0));
      }
      return mapa;
    },
  });

  const centros = useQuery({
    queryKey: ["centros", "options", "documentos"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("centros")
        .select("id, codigo, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const rotas = useQuery({
    queryKey: ["rotas", "options"],
    enabled: !!client && config.table === "pedidos",
    queryFn: async () => {
      const { data, error } = await client!
        .from("rotas")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const representantes = useQuery({
    queryKey: ["representantes", "options", "documentos"],
    enabled: !!client && config.table === "pedidos",
    queryFn: async () => {
      const { data, error } = await client!
        .from("representantes")
        .select("id, nome, profile_id, ativo")
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  /** Representante vinculado ao login atual (usado como padrão nos pedidos). */
  const meuRepresentante = String(
    representantes.data?.find((r) => r["profile_id"] && r["profile_id"] === user?.id)?.["id"] ?? "",
  );

  const representanteNome = (id: unknown) =>
    String(representantes.data?.find((r) => r["id"] === id)?.["nome"] ?? "—");

  const formas = useQuery({
    queryKey: ["formas_pagamento", "options"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("formas_pagamento")
        .select(
          "id, nome, parcelas_padrao, dias_primeira_parcela, intervalo_dias, taxa_percentual, desconto_percentual",
        )
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const itens = useQuery({
    queryKey: [config.itemsTable, user?.id, roles.slice().sort().join(","), selected],
    enabled: !!client && !!selected,
    queryFn: async () => {
      const { data, error } = await client!
        .from(config.itemsTable)
        .select(
          (config.table === "pedidos"
            ? "*, produto_peso:produtos(peso_kg,categoria)"
            : "*") as string,
        )
        .eq(config.parentKey, selected!)
        .order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Row[];
    },
  });

  /** Dia comercial de São Paulo, independentemente do fuso do navegador. */
  const hoje = hojeSaoPaulo();

  /** Filtros da listagem de documentos: pedidos abrem já no dia atual. */
  const [filtros, setFiltros] = useState<Record<string, string>>(() =>
    config.table === "pedidos" ? { de: hoje, ate: hoje } : {},
  );
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  /** Presets rápidos de período. */
  const setPeriodo = (de: string, ate: string) => setFiltros((s) => ({ ...s, de, ate }));
  const diasAtras = (n: number) => deslocarDataISO(hoje, -n);

  /** Representante só vê os próprios pedidos; admin/gestor vê todos. */
  const soMeusPedidos =
    config.table === "pedidos" &&
    !!meuRepresentante &&
    !roles.includes("admin") &&
    !roles.includes("gestor");

  const docsFiltrados = useMemo(() => {
    let list = docs.data ?? [];
    const f = filtros;
    if (soMeusPedidos)
      list = list.filter((d) => String(d["representante_id"] ?? "") === meuRepresentante);
    if (centro) list = list.filter((d) => !d["centro_id"] || d["centro_id"] === centro);
    if (f["tipo"]) list = list.filter((d) => String(d["tipo_documento"] ?? "pedido") === f["tipo"]);
    if (f["status"])
      list = list.filter(
        (d) =>
          (config.table === "pedidos" ? statusVisivelPedido(d, hoje) : String(d["status"])) ===
          f["status"],
      );
    if (f["centro"]) list = list.filter((d) => String(d["centro_id"] ?? "") === f["centro"]);
    if (f["rota"]) list = list.filter((d) => String(d["rota_id"] ?? "") === f["rota"]);
    if (f["representante"])
      list = list.filter((d) => String(d["representante_id"] ?? "") === f["representante"]);
    if (f["forma"]) list = list.filter((d) => String(d["forma_pagamento_id"] ?? "") === f["forma"]);
    if (f["parceiro"])
      list = list.filter((d) => String(d[config.partnerKey] ?? "") === f["parceiro"]);
    if (f["de"]) list = list.filter((d) => String(d[config.dateField] ?? "") >= f["de"]!);
    if (f["ate"]) list = list.filter((d) => String(d[config.dateField] ?? "") <= f["ate"]!);
    if (f["min"]) list = list.filter((d) => Number(d["total_liquido"] ?? 0) >= Number(f["min"]));
    if (f["max"]) list = list.filter((d) => Number(d["total_liquido"] ?? 0) <= Number(f["max"]));
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter((d) => {
        const parceiro = String(
          partners.data?.find((p) => p["id"] === d[config.partnerKey])?.["razao_social"] ?? "",
        ).toLowerCase();
        return (
          String(d["numero"] ?? "").includes(termo) ||
          parceiro.includes(termo) ||
          String(d["observacoes"] ?? "")
            .toLowerCase()
            .includes(termo)
        );
      });
    }
    return list;
  }, [
    docs.data,
    hoje,
    filtros,
    centro,
    partners.data,
    config.partnerKey,
    config.dateField,
    config.table,
    soMeusPedidos,
    meuRepresentante,
  ]);

  const statusOptions = useMemo(() => {
    const set = new Set(
      (docs.data ?? []).map((d) =>
        config.table === "pedidos" ? statusVisivelPedido(d, hoje) : String(d["status"]),
      ),
    );
    return [...set]
      .sort((a, b) =>
        config.table === "pedidos"
          ? ordemStatusPedido(a) - ordemStatusPedido(b) ||
            nomeStatusPedido(a).localeCompare(nomeStatusPedido(b), "pt-BR")
          : a.localeCompare(b),
      )
      .map((s) => ({ value: s, label: config.table === "pedidos" ? nomeStatusPedido(s) : s }));
  }, [docs.data, config.table, hoje]);

  const totalFiltrado = docsFiltrados.reduce((s, d) => s + Number(d["total_liquido"] ?? 0), 0);

  const selectedFromList = docs.data?.find((d) => d["id"] === selected);
  const selectedDoc = useQuery({
    queryKey: [config.table, "selecionado", user?.id, roles.slice().sort().join(","), selected],
    refetchInterval: config.table === "pedidos" ? 30_000 : false,
    enabled: !!client && !!selected && !selectedFromList && !docs.isPending,
    queryFn: async () => {
      const { data, error } = await client!
        .from(config.table)
        .select("*")
        .eq("id", selected!)
        .maybeSingle();
      if (error) throw new Error("Não foi possível carregar o documento selecionado.");
      return data as Row | null;
    },
  });
  const documento = selectedFromList ?? selectedDoc.data ?? null;
  const acompanhamento = useAcompanhamentoPedido(
    config.table === "pedidos" && documento ? String(documento["id"]) : "",
  );
  const doc =
    documento &&
    acompanhamento.pode &&
    acompanhamento.data &&
    !acompanhamento.isError &&
    config.table === "pedidos"
      ? {
          ...documento,
          status: acompanhamento.data.status,
          data_entrega: acompanhamento.data.data_entrega,
          tipo_documento: acompanhamento.data.tipo_documento ?? documento["tipo_documento"],
          orcamento_situacao:
            acompanhamento.data.orcamento_situacao ?? documento["orcamento_situacao"],
          orcamento_validade:
            acompanhamento.data.orcamento_validade ?? documento["orcamento_validade"],
          orcamento_data: acompanhamento.data.orcamento_data ?? documento["orcamento_data"],
          orcamento_aceito_em:
            acompanhamento.data.orcamento_aceito_em ?? documento["orcamento_aceito_em"],
        }
      : documento;

  const lojaDocumento = String(doc?.["centro_id"] ?? "");
  useEffect(() => {
    consultaPreco.current++;
    setItem({ ...emptyItem });
    setPromo(null);
    setConsultandoPreco(false);
  }, [lojaDocumento]);
  const catalogoPedido = useQuery({
    queryKey: ["loja-catalogo", "pedido", user?.id, lojaDocumento],
    enabled: !!client && config.table === "pedidos" && !!lojaDocumento,
    queryFn: () =>
      lerPaginas<Row>(async (inicio, fim) => {
        const { data, error } = await client!
          .rpc("listar_catalogo_loja_244", { _loja: lojaDocumento, _somente_disponiveis: true })
          .range(inicio, fim);
        return { data: data as Row[] | null, error };
      }),
  });
  const produtosDisponiveis =
    config.table === "pedidos" ? (catalogoPedido.data ?? []) : (produtos.data ?? []);

  const ehOrcamento = config.table === "pedidos" && doc?.["tipo_documento"] === "orcamento";
  const propostaEditavel =
    !ehOrcamento ||
    (doc != null &&
      statusVisivelPedido(doc) === "orcamento" &&
      permissoes.pode("pedidos_orcamentos"));

  /** Cliente em foco: o do diálogo de novo pedido ou o do documento aberto. */
  const clienteFoco =
    config.partnerTable === "clientes"
      ? String((openNew ? header["partner"] : doc?.["cliente_id"]) ?? "")
      : "";

  const credito = useQuery({
    queryKey: ["vw_cliente_credito", clienteFoco],
    enabled: !!client && !!clienteFoco,
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_cliente_credito")
        .select("*")
        .eq("cliente_id", clienteFoco)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as Row | null;
    },
  });

  const creditosDevolucao = useQuery({
    queryKey: ["creditos_clientes", clienteFoco, doc?.["centro_id"]],
    enabled: !!client && config.table === "pedidos" && !!clienteFoco,
    queryFn: async () => {
      const query = client!
        .from("creditos_clientes")
        .select("id, valor_original, valor_utilizado, saldo, status, centro_id, devolucao_id")
        .eq("cliente_id", clienteFoco)
        .neq("status", "cancelado")
        .gt("saldo", 0);
      if (doc?.["centro_id"]) query.eq("centro_id", String(doc["centro_id"]));
      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const titulosAbertos = useQuery({
    queryKey: ["contas_receber", "abertos", clienteFoco],
    enabled: !!client && !!clienteFoco,
    queryFn: async () => {
      const { data, error } = await client!
        .from("contas_receber")
        .select("id, documento, parcela, valor, valor_pago, vencimento, status")
        .eq("cliente_id", clienteFoco)
        .neq("status", "pago")
        .neq("status", "cancelado")
        .order("vencimento")
        .limit(30);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const createDoc = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        [config.partnerKey]: header["partner"] || null,
        [config.dateField]: header["data"] || hojeSaoPaulo(),
        centro_id: header["centro"] || centro || null,
        observacoes: header["observacoes"] || null,
      };
      if (config.table === "compras") {
        payload["nf_numero"] = header["nf"] || null;
        payload["chave_acesso"] = header["chave"] || null;
        payload["valor_impostos"] = Number(header["impostos"] || 0);
      } else {
        payload["rota_id"] = header["rota"] || null;
        payload["previsao_entrega"] = header["previsao"] || null;
        payload["forma_pagamento_id"] = header["forma"] || null;
        payload["representante_id"] = header["representante"] || meuRepresentante || null;
      }
      if (!payload[config.partnerKey]) throw new Error(`Selecione o ${config.partnerLabel}`);
      if (!payload["centro_id"]) {
        throw new Error(
          config.table === "pedidos"
            ? "Informe o centro de custo (cadastre no cliente para vir automático)"
            : "Informe o centro da compra ou selecione um centro no contexto global",
        );
      }
      if (config.table === "pedidos") {
        if (!payload["rota_id"])
          throw new Error("Informe a rota de entrega (cadastre no cliente para vir automático)");
        if (!payload["forma_pagamento_id"])
          throw new Error(
            "Informe a forma de pagamento (defina a condição de pagamento no cliente)",
          );
      }
      if (config.table === "pedidos" && header["natureza"] === "orcamento") {
        const { data, error } = await client!.rpc("criar_orcamento_236", {
          _cliente_id: payload["cliente_id"],
          _centro_id: payload["centro_id"],
          _rota_id: payload["rota_id"],
          _forma_pagamento_id: payload["forma_pagamento_id"],
          _data_pedido: payload["data_pedido"],
          _validade: header["validade"],
          _observacoes: payload["observacoes"],
          _representante_id: payload["representante_id"] || null,
        });
        if (error) throw new Error(error.message);
        return data as Row;
      }
      if (config.table === "pedidos") {
        const { data, error } = await client!.rpc("criar_pedido_rascunho", {
          _cliente_id: String(payload["cliente_id"]),
          _centro_id: String(payload["centro_id"]),
          _rota_id: String(payload["rota_id"]),
          _forma_pagamento_id: String(payload["forma_pagamento_id"]),
          _data_pedido: String(payload["data_pedido"]),
          _observacoes: payload["observacoes"] ? String(payload["observacoes"]) : null,
          _representante_id: payload["representante_id"]
            ? String(payload["representante_id"])
            : null,
        });
        if (error) throw new Error(error.message);
        return data as Row;
      }

      const { data, error } = await client!.rpc("criar_compra_rascunho", {
        _fornecedor_id: String(payload["fornecedor_id"]),
        _centro_id: String(payload["centro_id"]),
        _data_entrada: String(payload["data_entrada"]),
        _observacoes: payload["observacoes"] ? String(payload["observacoes"]) : null,
        _nf_numero: payload["nf_numero"] ? String(payload["nf_numero"]) : null,
        _chave_acesso: payload["chave_acesso"] ? String(payload["chave_acesso"]) : null,
        _valor_impostos: Number(payload["valor_impostos"] ?? 0),
      });
      if (error) throw new Error(error.message);
      return data as Row;
    },
    onSuccess: (data) => {
      toast.success("Documento criado — lance os itens e depois a forma de pagamento");
      setOpenNew(false);
      setHeader({});
      setSelected(String(data["id"]));
      atualizarDocumento();
      if (config.table === "pedidos") {
        queryClient.invalidateQueries({ queryKey: ["vw_margem_pedido_209"] });
        queryClient.invalidateQueries({ queryKey: ["margem-produtos"] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [creditoAplicacao, setCreditoAplicacao] = useState("");

  const creditoDisponivelDevolucao = (creditosDevolucao.data ?? []).reduce(
    (sum, c) => sum + Number(c["saldo"] ?? 0),
    0,
  );

  const creditoAplicadoPedido = useQuery({
    queryKey: ["credito_aplicacoes", selected],
    enabled: !!client && config.table === "pedidos" && !!selected,
    queryFn: async () => {
      const { data, error } = await client!
        .from("creditos_clientes_aplicacoes")
        .select("id, credito_id, valor, status")
        .eq("pedido_id", selected!);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const cancelarCreditoPedido = useMutation({
    mutationFn: async (aplicacaoId: string) => {
      const { error } = await client!.rpc("cancelar_aplicacao_credito", {
        _aplicacao_id: aplicacaoId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Aplicação de crédito cancelada");
      queryClient.invalidateQueries({ queryKey: ["creditos_clientes"] });
      queryClient.invalidateQueries({ queryKey: ["credito_aplicacoes", selected] });
      atualizarDocumento();
      if (config.table === "pedidos") {
        queryClient.invalidateQueries({ queryKey: ["vw_margem_pedido_209"] });
        queryClient.invalidateQueries({ queryKey: ["margem-produtos"] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const aplicarCreditoPedido = useMutation({
    mutationFn: async () => {
      if (!selected || !doc) throw new Error("Selecione um pedido");
      const valor = Number(creditoAplicacao || 0);
      if (valor <= 0) throw new Error("Informe o valor do crédito");
      const { error } = await client!.rpc("aplicar_creditos_cliente_pedido", {
        _pedido_id: selected,
        _valor: valor,
        _chave_idempotencia: crypto.randomUUID(),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Crédito reservado no pedido");
      setCreditoAplicacao("");
      queryClient.invalidateQueries({ queryKey: ["creditos_clientes"] });
      queryClient.invalidateQueries({ queryKey: ["credito_aplicacoes", selected] });
      atualizarDocumento();
      if (config.table === "pedidos") {
        queryClient.invalidateQueries({ queryKey: ["vw_margem_pedido_209"] });
        queryClient.invalidateQueries({ queryKey: ["margem-produtos"] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [pagamento, setPagamento] = useState<Record<string, string>>({});
  useEffect(() => setPagamento({}), [selected]);

  const savePagamento = useMutation({
    mutationFn: async () => {
      if (!doc) throw new Error("Selecione um documento");
      const patch: Record<string, unknown> = {
        forma_pagamento_id: pagamento["forma"] ?? doc["forma_pagamento_id"] ?? null,
        frete_valor: Number(pagamento["frete"] ?? doc["frete_valor"] ?? 0),
        desconto_valor: Number(pagamento["desconto"] ?? doc["desconto_valor"] ?? 0),
      };
      if (config.table === "pedidos") {
        patch["comissao_percentual"] = Number(
          pagamento["comissao"] ?? doc["comissao_percentual"] ?? 0,
        );
      }
      if (config.table === "pedidos") {
        const { error } = await client!.rpc("atualizar_pedido_comercial", {
          _pedido_id: String(doc["id"]),
          _forma_pagamento_id: String(patch["forma_pagamento_id"]),
          _frete_valor: Number(patch["frete_valor"] ?? 0),
          _desconto_valor: Number(patch["desconto_valor"] ?? 0),
          _comissao_percentual: Number(patch["comissao_percentual"] ?? 0),
        });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await client!.rpc("atualizar_compra_comercial", {
          _compra_id: String(doc["id"]),
          _forma_pagamento_id: patch["forma_pagamento_id"]
            ? String(patch["forma_pagamento_id"])
            : null,
          _frete_valor: Number(patch["frete_valor"] ?? 0),
          _desconto_valor: Number(patch["desconto_valor"] ?? 0),
        });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success("Forma de pagamento salva");
      setPagamento({});
      atualizarDocumento();
      if (config.table === "pedidos") {
        queryClient.invalidateQueries({ queryKey: ["vw_margem_pedido_209"] });
        queryClient.invalidateQueries({ queryKey: ["margem-produtos"] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function pickForma(id: string) {
    setPagamento((s) => ({ ...s, forma: id }));
  }

  const formaSelecionada =
    formas.data?.find(
      (f) => f["id"] === (pagamento["forma"] ?? doc?.["forma_pagamento_id"] ?? ""),
    ) ?? null;

  /** Prévia das parcelas conforme a forma de pagamento escolhida. */
  const previaParcelas = (() => {
    if (!doc || !formaSelecionada) return [];
    const total = Number(doc["total_liquido"] ?? 0);
    const qtd = Math.max(1, Number(formaSelecionada["parcelas_padrao"] ?? 1));
    const dias1 = Number(formaSelecionada["dias_primeira_parcela"] ?? 0);
    const intervalo = Number(formaSelecionada["intervalo_dias"] ?? 0);
    const base = ehOrcamento
      ? hojeSaoPaulo()
      : String(doc[config.dateField] ?? hojeSaoPaulo()).slice(0, 10);
    const valor = Math.round((total / qtd) * 100) / 100;
    let saldo = total;
    const list: { parcela: number; valor: number; vencimento: string }[] = [];
    for (let n = 1; n <= qtd; n++) {
      const v = n === qtd ? Math.round(saldo * 100) / 100 : valor;
      saldo = Math.round((saldo - v) * 100) / 100;
      const vencimento = deslocarDataISO(base, dias1 + (n - 1) * intervalo);
      list.push({ parcela: n, valor: v, vencimento: vencimento.split("-").reverse().join("/") });
    }
    return list;
  })();

  const addItem = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Selecione um documento");
      if (!item.produto_id) throw new Error("Selecione o produto");
      if (consultandoPreco) throw new Error("Aguarde a consulta do preço da loja");
      const payload: Record<string, unknown> = {
        [config.parentKey]: selected,
        produto_id: item.produto_id,
        quantidade: Number(item.quantidade || 0),
        [config.itemPriceField]: Number(item.preco || 0),
      };
      if (config.itemsTable === "pedido_itens") {
        payload["desconto_percentual"] = Number(item.desconto || 0);
      } else {
        payload["lote"] = item.lote || null;
        payload["validade"] = item.validade || null;
      }
      if (config.table === "pedidos") {
        const { error } = await client!.rpc("adicionar_item_pedido", {
          _pedido_id: selected,
          _produto_id: String(payload["produto_id"]),
          _quantidade: Number(payload["quantidade"]),
          _preco_unitario: Number(payload["preco_unitario"]),
          _desconto_percentual: Number(payload["desconto_percentual"] ?? 0),
        });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await client!.rpc("adicionar_item_compra", {
          _compra_id: selected,
          _produto_id: String(payload["produto_id"]),
          _quantidade: Number(payload["quantidade"]),
          _custo_unitario: Number(payload["custo_unitario"]),
          _lote: payload["lote"] ? String(payload["lote"]) : null,
          _validade: payload["validade"] ? String(payload["validade"]) : null,
        });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      setItem({ ...emptyItem });
      queryClient.invalidateQueries({
        queryKey: [config.itemsTable, user?.id, roles.slice().sort().join(","), selected],
      });
      if (config.table === "pedidos") {
        queryClient.invalidateQueries({ queryKey: ["desconto_peso_pedido", selected] });
      }
      atualizarDocumento();
      if (config.table === "pedidos") {
        queryClient.invalidateQueries({ queryKey: ["vw_margem_pedido_209"] });
        queryClient.invalidateQueries({ queryKey: ["margem-produtos"] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateItem = useMutation({
    mutationFn: async (patch: { id: string; values: Record<string, number> }) => {
      if (config.table === "pedidos") {
        const { error } = await client!.rpc("atualizar_item_pedido", {
          _item_id: patch.id,
          _quantidade: Number(patch.values["quantidade"] ?? 0),
          _preco_unitario: Number(patch.values["preco_unitario"] ?? 0),
          _desconto_percentual: Number(patch.values["desconto_percentual"] ?? 0),
        });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await client!.rpc("atualizar_item_compra", {
          _item_id: patch.id,
          _quantidade: Number(patch.values["quantidade"] ?? 0),
          _custo_unitario: Number(patch.values["custo_unitario"] ?? 0),
        });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [config.itemsTable, user?.id, roles.slice().sort().join(","), selected],
      });
      if (config.table === "pedidos") {
        queryClient.invalidateQueries({ queryKey: ["desconto_peso_pedido", selected] });
      }
      atualizarDocumento();
      if (config.table === "pedidos") {
        queryClient.invalidateQueries({ queryKey: ["vw_margem_pedido_209"] });
        queryClient.invalidateQueries({ queryKey: ["margem-produtos"] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      if (config.table === "pedidos") {
        const { error } = await client!.rpc("remover_item_pedido", { _item_id: id });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await client!.rpc("remover_item_compra", { _item_id: id });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [config.itemsTable, user?.id, roles.slice().sort().join(","), selected],
      });
      if (config.table === "pedidos") {
        queryClient.invalidateQueries({ queryKey: ["desconto_peso_pedido", selected] });
      }
      atualizarDocumento();
      if (config.table === "pedidos") {
        queryClient.invalidateQueries({ queryKey: ["vw_margem_pedido_209"] });
        queryClient.invalidateQueries({ queryKey: ["margem-produtos"] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const efetivar = useMutation({
    mutationFn: async (): Promise<string | null> => {
      if (config.table === "pedidos" && doc) {
        if (ehOrcamento)
          throw new Error(
            "Registre o aceite do orçamento antes da aprovação e confirmação da venda",
          );
        if (edicaoPendente || pagamentoAlterado)
          throw new Error(
            "Aguarde o salvamento dos itens e salve as alterações de pagamento antes de confirmar.",
          );
        const pendencias = conferirPedido(doc as PedidoConferencia, itens.data ?? []);
        if (pendencias.length) throw new Error(pendencias.join(" "));
        if (!doc["centro_id"]) throw new Error("Informe o centro de custo do pedido");
        if (!doc["rota_id"]) throw new Error("Informe a rota de entrega do pedido");
        if (!doc["forma_pagamento_id"]) throw new Error("Informe a forma de pagamento do pedido");
        // Regras de crédito: bloqueios mandam o pedido direto para aprovação.
        if (String(doc["status"]) !== "aprovado") {
          const { data: val, error: vErr } = await client!.rpc("validar_pedido", {
            _pedido_id: selected,
          });
          if (vErr) throw new Error(vErr.message);
          const bloqueios = ((val ?? []) as { nivel: string; mensagem: string }[]).filter(
            (v) => v.nivel === "bloqueio",
          );
          if (bloqueios.length > 0) {
            const { error: aErr } = await client!.rpc("avancar_pedido", {
              _pedido_id: selected,
              _novo_status: "aguardando_aprovacao",
            });
            if (aErr) throw new Error(aErr.message);
            return bloqueios.map((b) => b.mensagem).join(" | ");
          }
        }
      }
      const args =
        config.rpc === "confirmar_pedido" ? { _pedido_id: selected } : { _compra_id: selected };
      const { error } = await client!.rpc(config.rpc, args);
      if (error) throw new Error(error.message);
      return null;
    },
    onSuccess: (motivo) => {
      if (motivo) toast.warning(`Pedido enviado para aprovação: ${motivo}`, { duration: 8000 });
      else toast.success(`${config.rpcLabel} concluído — estoque e financeiro atualizados`);
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Compra feita, mercadoria ainda não recebida. */
  const marcarComprado = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("marcar_compra_comprada", { _compra_id: selected });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Compra marcada como comprada — aguardando o recebimento");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelar = useMutation({
    mutationFn: async () => {
      if (config.table === "pedidos") {
        const { error } = await client!.rpc("cancelar_pedido", { _pedido_id: selected });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await client!.rpc("cancelar_compra", { _compra_id: selected });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success("Documento cancelado");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Fluxo de status do pedido: próximos passos permitidos. */
  const proximosStatus: Record<string, { status: string; label: string }[]> = {
    rascunho: [{ status: "aguardando_aprovacao", label: "Enviar para aprovação" }],
    digitacao: [{ status: "aguardando_aprovacao", label: "Enviar para aprovação" }],
    aguardando_aprovacao: [
      { status: "aprovado", label: "Aprovar" },
      { status: "recusado", label: "Recusar" },
    ],
  };

  const avancar = useMutation({
    mutationFn: async (novo: string) => {
      const { error } = await client!.rpc("avancar_pedido", {
        _pedido_id: selected,
        _novo_status: novo,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Status do pedido atualizado");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Aprovação comercial automática (crédito, títulos, estoque, margem, desconto). */
  const validacao = useQuery({
    queryKey: ["validar_pedido", selected],
    enabled: !!client && !!selected && config.table === "pedidos",
    queryFn: async () => {
      const { data, error } = await client!.rpc("validar_pedido", { _pedido_id: selected });
      if (error) throw new Error(error.message);
      return (data ?? []) as { nivel: string; mensagem: string }[];
    },
  });

  /** Desconto escalonado por peso (kg) dos itens do pedido. */
  const descontoPeso = useQuery({
    queryKey: ["desconto_peso_pedido", selected],
    enabled: !!client && !!selected && config.table === "pedidos",
    queryFn: async () => {
      const { data, error } = await client!.rpc("desconto_peso_pedido", { _pedido_id: selected });
      if (error) throw new Error(error.message);
      const info = (Array.isArray(data) ? data[0] : data) as
        | {
            peso_total: number;
            faixa_nome: string | null;
            percentual: number;
            desconto_valor: number;
          }
        | undefined;
      return info ?? null;
    },
  });

  const aplicarDescontoPeso = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("aplicar_desconto_peso", { _pedido_id: selected });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Desconto por peso aplicado ao pedido");
      setPagamento((s) => {
        const { desconto: _ignored, ...rest } = s;
        return rest;
      });
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Preço do item: em pedidos vale o preço vigente da promoção (tabela de preço
   * dentro do período de vigência para o cliente/UF). Sem promoção vigente,
   * usa o preço-base configurado na loja do documento.
   */
  async function pickProduto(id: string) {
    const p = produtosDisponiveis.find((x) => x["id"] === id);
    const sequencia = ++consultaPreco.current;
    const base = Number(
      (config.table === "pedidos" ? p?.["preco_venda"] : p?.["custo_medio"]) ?? 0,
    );
    setItem((s) => ({ ...s, produto_id: id, preco: String(base) }));
    setPromo(null);
    if (config.table !== "pedidos" || !id || !client) {
      setConsultandoPreco(false);
      return;
    }
    setConsultandoPreco(true);
    const { data, error } = await client.rpc("preco_item_pedido_244", {
      _produto: id,
      _pedido: selected,
    });
    if (sequencia !== consultaPreco.current) return;
    setConsultandoPreco(false);
    if (error) {
      setItem((s) => ({ ...s, produto_id: "", preco: "" }));
      toast.error(error.message);
      return;
    }
    const info = (Array.isArray(data) ? data[0] : data) as
      | {
          preco: number;
          tabela_nome: string | null;
          vigencia_fim: string | null;
          promocao: boolean;
        }
      | undefined;
    const vigente = Number(info?.preco ?? 0);
    if (!info || !Number.isFinite(vigente) || vigente < 0) {
      setItem((s) => ({ ...s, produto_id: "", preco: "" }));
      toast.error("Não foi possível obter o preço desta loja.");
      return;
    }
    setItem((s) => (s.produto_id === id ? { ...s, preco: String(vigente) } : s));
    if (info?.promocao && vigente !== base) {
      setPromo({
        preco: vigente,
        nome: String(info.tabela_nome ?? "Promoção"),
        fim: info.vigencia_fim ?? null,
      });
    }
  }

  /** Ao escolher o cliente, traz rota, centro de custo e forma de pagamento do cadastro dele. */
  function pickPartner(id: string) {
    const p = partners.data?.find((x) => x["id"] === id);
    const condicao = String(p?.["condicao_pagamento"] ?? "")
      .trim()
      .toLowerCase();
    const formaCliente = condicao
      ? formas.data?.find((f) => String(f["nome"]).trim().toLowerCase() === condicao)
      : undefined;
    setHeader((h) => ({
      ...h,
      partner: id,
      ...(config.table === "pedidos"
        ? {
            rota: String(p?.["rota_id"] ?? ""),
            centro: String(p?.["centro_id"] ?? h["centro"] ?? ""),
            forma: String(formaCliente?.["id"] ?? ""),
            representante: String(
              meuRepresentante || p?.["representante_id"] || h["representante"] || "",
            ),
          }
        : {}),
    }));
  }

  const creditoPainel = (() => {
    if (config.partnerTable !== "clientes" || !clienteFoco) return null;
    const c = credito.data;
    const limite = Number(c?.["limite_credito"] ?? 0);
    const aberto = Number(c?.["em_aberto"] ?? 0);
    const disponivel = Number(c?.["limite_disponivel"] ?? limite - aberto);
    const vencido = Number(c?.["vencido"] ?? 0);
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Situação de crédito do cliente
        </p>
        <div className="mt-2 grid gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Limite</p>
            <p className="text-sm font-semibold">{brl(limite)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Em aberto</p>
            <p className="text-sm font-semibold">{brl(aberto)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Disponível</p>
            <p className={`text-sm font-semibold ${disponivel < 0 ? "text-destructive" : ""}`}>
              {brl(disponivel)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Vencido</p>
            <p className={`text-sm font-semibold ${vencido > 0 ? "text-destructive" : ""}`}>
              {brl(vencido)}
            </p>
          </div>
        </div>
        {(titulosAbertos.data ?? []).length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parcela</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {titulosAbertos.data!.map((t) => {
                  const saldo = Number(t["valor"] ?? 0) - Number(t["valor_pago"] ?? 0);
                  const venc = String(t["vencimento"] ?? "");
                  const atrasado = venc < hojeSaoPaulo();
                  return (
                    <TableRow key={String(t["id"])}>
                      <TableCell>
                        {String(t["documento"] ?? "—")}/{String(t["parcela"] ?? 1)}
                      </TableCell>
                      <TableCell className={atrasado ? "text-destructive" : ""}>
                        {venc ? new Date(`${venc}T00:00:00`).toLocaleDateString("pt-BR") : "—"}
                      </TableCell>
                      <TableCell className="text-right">{brl(saldo)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Nenhuma parcela em aberto para este cliente.
          </p>
        )}
      </div>
    );
  })();

  const partnerName = (id: unknown) =>
    String(partners.data?.find((p) => p["id"] === id)?.["razao_social"] ?? "—");
  const produtoCodigo = (id: unknown) =>
    String(produtos.data?.find((p) => p["id"] === id)?.["codigo"] ?? "").trim() || "—";
  const produtoName = (id: unknown) =>
    String(produtos.data?.find((p) => p["id"] === id)?.["descricao"] ?? "—");
  const produtoPeso = (id: unknown) =>
    Number(produtos.data?.find((p) => p["id"] === id)?.["peso_kg"] ?? 0);
  const pesoItem = (it: Row) =>
    Number(
      (it["produto_peso"] as { peso_kg?: number } | null)?.peso_kg ?? produtoPeso(it["produto_id"]),
    ) * Number(it["quantidade"] ?? 0);
  const pesoTotal = (itens.data ?? []).reduce((s, it) => s + pesoItem(it), 0);
  const edicaoPendente =
    encargosPendentes ||
    addItem.isPending ||
    updateItem.isPending ||
    removeItem.isPending ||
    savePagamento.isPending;
  const pagamentoAlterado =
    !!doc &&
    Object.entries(pagamento).some(([key, value]) => {
      const column = {
        forma: "forma_pagamento_id",
        frete: "frete_valor",
        desconto: "desconto_valor",
        comissao: "comissao_percentual",
      }[key];
      return column
        ? key === "forma"
          ? value !== String(doc[column] ?? "")
          : Number(value) !== Number(doc[column] ?? 0)
        : false;
    });
  const avisosPedido =
    config.table === "pedidos" && doc && itens.isSuccess
      ? conferirPedido(doc as PedidoConferencia, itens.data ?? [])
      : [];
  if (config.table === "pedidos" && pagamentoAlterado)
    avisosPedido.push("Salve as alterações de pagamento antes de confirmar.");
  if (encargosPendentes) avisosPedido.push("Atualize os encargos antes de confirmar.");
  const kg = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`;
  /** Nome da forma com o acréscimo/desconto configurado. */
  const formaLabel = (f: Row) => {
    const acr = Number(f["taxa_percentual"] ?? 0);
    const desc = Number(f["desconto_percentual"] ?? 0);
    const extras = [
      acr > 0 ? `+${acr.toLocaleString("pt-BR")}%` : "",
      desc > 0 ? `−${desc.toLocaleString("pt-BR")}%` : "",
    ].filter(Boolean);
    return extras.length ? `${String(f["nome"])} (${extras.join(" ")})` : String(f["nome"]);
  };

  const statusTone = (s: string) => {
    const v = s.toLowerCase();
    if (v.startsWith("cancel")) return "bg-destructive/10 text-destructive";
    if (["faturado", "entregue", "liquidado", "recebido"].includes(v))
      return "bg-primary/15 text-primary";
    if (["aprovado", "confirmado"].includes(v)) return "bg-emerald-500/15 text-emerald-600";
    if (["separacao", "separado", "expedicao", "em_rota"].includes(v))
      return "bg-amber-500/15 text-amber-600";
    return "bg-secondary text-secondary-foreground";
  };
  const fmtDate = (v: unknown) => {
    const s = String(v ?? "");
    return s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR") : "—";
  };
  const ticket = docsFiltrados.length ? totalFiltrado / docsFiltrados.length : 0;
  const abertos = docsFiltrados.filter((d) =>
    config.table === "pedidos"
      ? ![
          "entregue",
          "cancelado",
          "recusado",
          "devolvido",
          "orcamento_recusado",
          "orcamento_expirado",
        ].includes(statusVisivelPedido(d, hoje))
      : ["rascunho", "digitacao", "aprovado", "confirmado", "separacao", "separado"].includes(
          String(d["status"]).toLowerCase(),
        ),
  ).length;
  const statusResumo = (() => {
    const m = new Map<string, number>();
    for (const d of docsFiltrados) {
      const k = config.table === "pedidos" ? statusVisivelPedido(d, hoje) : String(d["status"]);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) =>
      config.table === "pedidos"
        ? ordemStatusPedido(a[0]) - ordemStatusPedido(b[0]) ||
          nomeStatusPedido(a[0]).localeCompare(nomeStatusPedido(b[0]), "pt-BR")
        : b[1] - a[1],
    );
  })();

  const listaVisivel = !selected && !openNew;

  const fechamentoDocumento = doc ? (
    <div
      className="rounded-lg border border-border bg-card p-5"
      aria-label="Finalização do documento"
    >
      {config.table === "pedidos" && (roles.includes("admin") || roles.includes("gestor"))
        ? (() => {
            const custo = (itens.data ?? []).reduce((s, it) => {
              const p = (produtos.data ?? []).find((x) => x["id"] === it["produto_id"]);
              return s + Number(it["quantidade"] ?? 0) * Number(p?.["custo_medio"] ?? 0);
            }, 0);
            const venda = Number(doc["total_liquido"] ?? 0);
            const comissao = Number(doc["comissao_valor"] ?? 0);
            const lucro = venda - custo;
            const liquido = lucro - comissao;
            const markup = custo > 0 ? (venda / custo - 1) * 100 : 0;
            const margem = venda > 0 ? (lucro / venda) * 100 : 0;
            const pct = (n: number) =>
              `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
            const cards: [string, string, boolean?][] = [
              ["Comissão", brl(comissao)],
              ["Custo", brl(custo)],
              ["Lucro bruto", brl(lucro), lucro < 0],
              ["Lucro após comissão", brl(liquido), liquido < 0],
              ["Markup", pct(markup), markup < 0],
              ["Margem", pct(margem), margem < 0],
            ];
            return (
              <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-3 lg:grid-cols-6">
                {cards.map(([l, v, neg]) => (
                  <div key={l}>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{l}</p>
                    <p className={`text-sm font-semibold ${neg ? "text-destructive" : ""}`}>{v}</p>
                  </div>
                ))}
              </div>
            );
          })()
        : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {config.table === "pedidos" ? (
          <ImprimirPedidos
            pedidoIds={[String(doc["id"])]}
            label={ehOrcamento ? "Imprimir orçamento" : "Imprimir pedido"}
          />
        ) : null}
        {config.table === "pedidos" &&
        !ehOrcamento &&
        !["rascunho", "digitacao", "aprovado", "cancelado"].includes(String(doc["status"])) ? (
          <EmitirBoletosPedido
            key={String(doc["id"])}
            pedidoId={String(doc["id"])}
            centroId={String(doc["centro_id"] ?? "")}
          />
        ) : null}
        {!ehOrcamento && (
          <Button
            onClick={() => efetivar.mutate()}
            disabled={
              !["rascunho", "digitacao", "aprovado", "comprado"].includes(String(doc["status"])) ||
              efetivar.isPending ||
              (config.table === "pedidos" &&
                (edicaoPendente ||
                  itens.isPending ||
                  itens.isError ||
                  itens.isFetching ||
                  avisosPedido.length > 0)) ||
              !canWrite
            }
          >
            {efetivar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {config.rpcLabel}
          </Button>
        )}
        {config.table === "compras" && String(doc["status"]) === "rascunho" ? (
          <Button
            variant="secondary"
            onClick={() => marcarComprado.mutate()}
            disabled={marcarComprado.isPending || !canWrite}
          >
            {marcarComprado.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Marcar como comprado
          </Button>
        ) : null}
        {config.table === "pedidos" && doc["status"] === "confirmado" && (
          <SelecionarPedidosLote
            pedidos={[
              {
                id: String(doc["id"]),
                numero: String(doc["numero"]),
                cliente: partnerName(doc["cliente_id"]),
              },
            ]}
          />
        )}
        {config.table === "pedidos" && !ehOrcamento
          ? (proximosStatus[String(doc["status"])] ?? [])
              .filter(
                (s) =>
                  !["aprovado", "recusado"].includes(s.status) ||
                  roles.includes("admin") ||
                  roles.includes("gestor"),
              )
              .map((s) => (
                <Button
                  key={s.status}
                  variant="secondary"
                  onClick={() => avancar.mutate(s.status)}
                  disabled={
                    avancar.isPending || edicaoPendente || pagamentoAlterado || itens.isFetching
                  }
                >
                  {s.label}
                </Button>
              ))
          : null}
        {!ehOrcamento && (
          <Button
            variant="outline"
            onClick={() => cancelar.mutate()}
            disabled={String(doc["status"]).startsWith("cancel") || cancelar.isPending || !canWrite}
          >
            Cancelar documento
          </Button>
        )}
      </div>

      {config.table === "pedidos" && (validacao.data ?? []).length > 0 ? (
        <div className="mt-4 space-y-1.5 rounded-md border border-border bg-background p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Aprovação comercial
          </p>
          {(validacao.data ?? []).map((v, i) => (
            <p
              key={i}
              className={`text-sm ${
                v.nivel === "bloqueio" ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {v.nivel === "bloqueio" ? "🔴 BLOQUEIO" : "🟡 Atenção"} — {v.mensagem}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;
  return (
    <div className="space-y-6">
      <section className={`space-y-3 ${listaVisivel ? "" : "hidden"}`}>
        <div className="flex justify-end">
          {config.table === "pedidos" ? (
            <ImprimirPedidos
              pedidoIds={docsFiltrados.map((d) => String(d["id"]))}
              label="Imprimir documentos do filtro"
            />
          ) : null}
          {config.table === "pedidos" && permissoes.pode("pedidos_orcamentos") && (
            <Button
              variant="outline"
              onClick={() => {
                setHeader((h) => ({
                  ...h,
                  natureza: "orcamento",
                  validade: deslocarDataISO(hoje, 15),
                }));
                setOpenNew(true);
              }}
            >
              Novo orçamento
            </Button>
          )}
          <Button
            onClick={() => {
              setHeader((h) => ({ ...h, natureza: "pedido" }));
              setOpenNew(true);
            }}
            disabled={!canWrite}
          >
            <Plus className="size-4" /> {config.table === "compras" ? "Nova compra" : "Novo Pedido"}
          </Button>
        </div>

        {config.table === "pedidos" ? (
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: "Hoje", de: hoje, ate: hoje },
              { label: "Últimos 7 dias", de: diasAtras(6), ate: hoje },
              { label: "Últimos 30 dias", de: diasAtras(29), ate: hoje },
              { label: "Todo o período", de: "", ate: "" },
            ].map((p) => {
              const ativo = (filtros["de"] ?? "") === p.de && (filtros["ate"] ?? "") === p.ate;
              return (
                <button
                  key={p.label}
                  onClick={() => setPeriodo(p.de, p.ate)}
                  className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
                    ativo
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <FilterBar
          onClear={() => setFiltros(config.table === "pedidos" ? { de: hoje, ate: hoje } : {})}
        >
          <FilterText
            label="Buscar"
            value={filtros["busca"] ?? ""}
            onChange={(v) => setF("busca", v)}
            placeholder={`Nº, ${config.partnerLabel.toLowerCase()} ou observação`}
          />
          {config.table === "pedidos" && (
            <FilterSelect
              label="Tipo de documento"
              value={filtros["tipo"] ?? ""}
              onChange={(v) => setF("tipo", v)}
              options={[
                { value: "pedido", label: "Pedidos" },
                { value: "orcamento", label: "Orçamentos" },
              ]}
            />
          )}
          <FilterSelect
            label="Status"
            value={filtros["status"] ?? ""}
            onChange={(v) => setF("status", v)}
            options={statusOptions}
          />
          <FilterSelect
            label={config.partnerLabel}
            value={filtros["parceiro"] ?? ""}
            onChange={(v) => setF("parceiro", v)}
            options={(partners.data ?? []).map((p) => ({
              value: String(p["id"]),
              label: String(p["razao_social"]),
            }))}
          />
          <FilterSelect
            label="Centro de custo"
            value={filtros["centro"] ?? ""}
            onChange={(v) => setF("centro", v)}
            options={(centros.data ?? []).map((c) => ({
              value: String(c["id"]),
              label: String(c["nome"]),
            }))}
          />
          {config.table === "pedidos" ? (
            <>
              <FilterSelect
                label="Rota"
                value={filtros["rota"] ?? ""}
                onChange={(v) => setF("rota", v)}
                options={(rotas.data ?? []).map((r) => ({
                  value: String(r["id"]),
                  label: String(r["nome"]),
                }))}
              />
              <FilterSelect
                label="Representante"
                value={filtros["representante"] ?? ""}
                onChange={(v) => setF("representante", v)}
                options={(representantes.data ?? []).map((r) => ({
                  value: String(r["id"]),
                  label: String(r["nome"]),
                }))}
              />
            </>
          ) : null}
          <FilterSelect
            label="Forma de pagamento"
            value={filtros["forma"] ?? ""}
            onChange={(v) => setF("forma", v)}
            options={(formas.data ?? []).map((f) => ({
              value: String(f["id"]),
              label: String(f["nome"]),
            }))}
          />
          <FilterText
            label={`${config.dateLabel} de`}
            type="date"
            value={filtros["de"] ?? ""}
            onChange={(v) => setF("de", v)}
          />
          <FilterText
            label={`${config.dateLabel} até`}
            type="date"
            value={filtros["ate"] ?? ""}
            onChange={(v) => setF("ate", v)}
          />
          <FilterText
            label="Valor mínimo"
            type="number"
            value={filtros["min"] ?? ""}
            onChange={(v) => setF("min", v)}
          />
          <FilterText
            label="Valor máximo"
            type="number"
            value={filtros["max"] ?? ""}
            onChange={(v) => setF("max", v)}
          />
        </FilterBar>

        <div className="grid grid-cols-3 gap-2 sm:max-w-xl">
          {[
            { label: "Documentos", value: String(docsFiltrados.length) },
            { label: "Total", value: brl(totalFiltrado) },
            { label: "Ticket médio", value: brl(ticket) },
          ].map((k) => (
            <div key={k.label} className="rounded-lg border border-border bg-card px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
              <p className="truncate text-sm font-semibold">{k.value}</p>
            </div>
          ))}
        </div>

        {statusResumo.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setF("status", "")}
              className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                !filtros["status"]
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              Todos ({docsFiltrados.length})
            </button>
            {statusResumo.map(([s, n]) => (
              <button
                key={s}
                onClick={() => setF("status", filtros["status"] === s ? "" : s)}
                className={`rounded-full px-2.5 py-1 text-[11px] capitalize transition-colors ${
                  filtros["status"] === s
                    ? "bg-primary text-primary-foreground"
                    : `${statusTone(s)} hover:opacity-80`
                }`}
              >
                {config.table === "pedidos" ? nomeStatusPedido(s) : s.replace(/_/g, " ")} ({n})
              </button>
            ))}
          </div>
        ) : null}

        {config.table === "pedidos" && (
          <div className="flex flex-wrap gap-2">
            <SelecionarPedidosLote
              pedidos={docsFiltrados
                .filter((p) => p["status"] === "confirmado")
                .map((p) => ({
                  id: String(p["id"]),
                  numero: String(p["numero"]),
                  cliente: partnerName(p["cliente_id"]),
                }))}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {abertos} em andamento · {docsFiltrados.length} no filtro
        </p>

        <div className="rounded-lg border border-border bg-card sm:overflow-x-auto">
          {docs.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : docs.isError ? (
            <p className="p-4 text-sm text-destructive">{(docs.error as Error).message}</p>
          ) : docsFiltrados.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">Nenhum documento neste filtro.</p>
              <Button variant="link" onClick={() => setFiltros({})} className="text-xs">
                Limpar filtros
              </Button>
            </div>
          ) : (
            <>
              {/* Mobile: cartões */}
              <ul className="divide-y divide-border sm:hidden">
                {docsFiltrados.map((d) => {
                  const ativo = selected === d["id"];
                  return (
                    <li
                      key={String(d["id"])}
                      onClick={() => setSelected(String(d["id"]))}
                      className={`cursor-pointer border-l-2 p-3 transition-colors ${
                        ativo
                          ? "border-l-primary bg-accent"
                          : "border-l-transparent active:bg-accent/50"
                      }`}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">#{String(d["numero"])}</p>
                          <p className="truncate text-sm">{partnerName(d[config.partnerKey])}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmtDate(d[config.dateField])}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold">{brl(d["total_liquido"])}</p>
                          <span
                            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusTone(
                              String(d["status"]),
                            )}`}
                          >
                            {config.table === "pedidos"
                              ? nomeStatusPedido(statusVisivelPedido(d, hoje))
                              : String(d["status"]).replace(/_/g, " ")}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <table className="hidden w-full min-w-[720px] text-sm sm:table">
                <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Nº</th>
                    <th className="px-4 py-2 text-left font-medium">{config.partnerLabel}</th>
                    {config.table === "pedidos" ? (
                      <th className="px-4 py-2 text-left font-medium">Representante</th>
                    ) : null}
                    <th className="px-4 py-2 text-left font-medium">{config.dateLabel}</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {docsFiltrados.map((d) => {
                    const ativo = selected === d["id"];
                    return (
                      <tr
                        key={String(d["id"])}
                        onClick={() => setSelected(String(d["id"]))}
                        className={`cursor-pointer border-l-2 transition-colors ${
                          ativo
                            ? "border-l-primary bg-accent"
                            : "border-l-transparent hover:border-l-primary/40 hover:bg-accent/50"
                        }`}
                      >
                        <td className="px-4 py-2.5 font-semibold">#{String(d["numero"])}</td>
                        <td className="max-w-[380px] truncate px-4 py-2.5">
                          {partnerName(d[config.partnerKey])}
                        </td>
                        {config.table === "pedidos" ? (
                          <td className="max-w-[220px] truncate px-4 py-2.5 text-muted-foreground">
                            {representanteNome(d["representante_id"])}
                          </td>
                        ) : null}
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {fmtDate(d[config.dateField])}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusTone(
                              String(d["status"]),
                            )}`}
                          >
                            {config.table === "pedidos"
                              ? nomeStatusPedido(statusVisivelPedido(d, hoje))
                              : String(d["status"]).replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold">
                          {brl(d["total_liquido"])}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </section>

      <section className="space-y-4">
        {!doc ? (
          selected ? (
            <div className="rounded-xl border bg-card p-6 text-sm">
              <p role={selectedDoc.isError ? "alert" : "status"}>
                {docs.isPending || selectedDoc.isPending
                  ? "Carregando documento…"
                  : selectedDoc.isError
                    ? "Não foi possível carregar o documento. Tente atualizar a página."
                    : "Documento não encontrado ou sem acesso."}
              </p>
              <Button className="mt-3" variant="outline" onClick={() => setSelected(null)}>
                Voltar à lista
              </Button>
            </div>
          ) : listaVisivel ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Selecione um documento na lista acima ou crie um novo.
            </div>
          ) : null
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
              ← Voltar à lista
            </Button>
            {config.table === "pedidos" &&
              ["separacao", "separado", "conferido", "faturado", "em_carga", "em_rota"].includes(
                String(doc["status"]),
              ) && (
                <p className="rounded-lg border bg-muted/30 p-3 text-sm">
                  {["separacao", "separado"].includes(String(doc["status"]))
                    ? "Próxima etapa: concluir a separação no menu Separação."
                    : ["conferido", "faturado"].includes(String(doc["status"]))
                      ? "Separação concluída. Próxima etapa: incluir o pedido em Cargas de entrega."
                      : doc["status"] === "em_carga"
                        ? "Pedido incluído na carga. Aguardando o despacho para saída em rota."
                        : "Pedido em rota. O recebimento será formalizado no menu Entregas."}
                </p>
              )}
            {config.table === "pedidos" && <AcompanhamentoPedido acompanhamento={acompanhamento} />}
            {config.table === "pedidos" && (
              <ResumoPedido
                doc={doc}
                peso={pesoTotal}
                avisos={avisosPedido}
                carregando={itens.isPending || itens.isFetching || edicaoPendente}
              />
            )}
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {config.partnerLabel}: {partnerName(doc[config.partnerKey])}
                  </p>
                  <h2 className="text-lg font-semibold">
                    #{String(doc["numero"])} ·{" "}
                    {config.table === "pedidos"
                      ? nomeStatusPedido(statusVisivelPedido(doc))
                      : String(doc["status"])}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ehOrcamento ? "Data da proposta" : config.dateLabel}:{" "}
                    {String(doc[config.dateField] ?? "—")} · {String(doc["parcelas"])}x ·{" "}
                    {String(
                      formas.data?.find((f) => f["id"] === doc["forma_pagamento_id"])?.["nome"] ??
                        "sem forma de pagamento",
                    )}{" "}
                    ·{" "}
                    {String(
                      centros.data?.find((c) => c["id"] === doc["centro_id"])?.["nome"] ??
                        "sem centro",
                    )}
                    {config.table === "pedidos"
                      ? ` · Representante: ${representanteNome(doc["representante_id"])}`
                      : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Itens {brl(doc["total_itens"])}</p>
                  <p className="text-xl font-semibold">{brl(doc["total_liquido"])}</p>
                  {config.table === "pedidos" ? (
                    <>
                      {Number(doc["forma_acrescimo_valor"] ?? 0) > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Acréscimo da forma {brl(doc["forma_acrescimo_valor"])}
                        </p>
                      ) : null}
                      {Number(doc["forma_desconto_valor"] ?? 0) > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Desconto da forma −{brl(doc["forma_desconto_valor"])}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">Peso total {kg(pesoTotal)}</p>
                      <p className="mt-1 inline-block rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                        {ehOrcamento ? "Comissão estimada" : "Sua comissão"}{" "}
                        {brl(doc["comissao_valor"])}
                        {Number(doc["comissao_percentual"] ?? 0) > 0
                          ? ` (${Number(doc["comissao_percentual"]).toLocaleString("pt-BR")}%)`
                          : ""}
                      </p>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            {config.table === "compras" && fechamentoDocumento}
            {creditoPainel}
            {config.table === "pedidos" &&
            !ehOrcamento &&
            doc["status"] === "rascunho" &&
            clienteFoco ? (
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">Crédito de devoluções</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Crédito disponível deste cliente no centro do pedido. Ele reduz o valor que será
                  gerado no contas a receber.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Resumo label="Disponível" value={brl(creditoDisponivelDevolucao)} />
                  <Resumo
                    label="Aplicado neste pedido"
                    value={brl(
                      (creditoAplicadoPedido.data ?? [])
                        .filter((a) => ["reservado", "aplicado"].includes(String(a["status"])))
                        .reduce((sum, a) => sum + Number(a["valor"] ?? 0), 0),
                    )}
                  />
                  <Resumo label="Total do pedido" value={brl(doc["total_liquido"])} />
                </div>
                {(creditoAplicadoPedido.data ?? []).some(
                  (a) => String(a["status"]) === "reservado",
                ) ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium">Reservas deste pedido</p>
                    {(creditoAplicadoPedido.data ?? [])
                      .filter((a) => String(a["status"]) === "reservado")
                      .map((a) => (
                        <div
                          key={String(a["id"])}
                          className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                        >
                          <span>{brl(a["valor"])}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={cancelarCreditoPedido.isPending}
                            onClick={() => cancelarCreditoPedido.mutate(String(a["id"]))}
                          >
                            Cancelar
                          </Button>
                        </div>
                      ))}
                  </div>
                ) : null}
                {creditoDisponivelDevolucao > 0 ? (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div className="min-w-48 flex-1 space-y-1.5">
                      <Label>Valor do crédito</Label>
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        max={String(creditoDisponivelDevolucao)}
                        value={creditoAplicacao}
                        onChange={(e) => setCreditoAplicacao(e.target.value)}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      disabled={aplicarCreditoPedido.isPending}
                      onClick={() => aplicarCreditoPedido.mutate()}
                    >
                      {aplicarCreditoPedido.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      Aplicar crédito
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Nenhum crédito de devolução disponível para este cliente neste centro.
                  </p>
                )}
              </div>
            ) : null}

            {["rascunho", "digitacao"].includes(String(doc["status"])) && propostaEditavel ? (
              <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[minmax(320px,4fr)_1fr_1fr_1fr_auto]">
                <div className="space-y-1.5">
                  <Label>Produto</Label>
                  {config.table === "pedidos" && catalogoPedido.isError && (
                    <p role="alert" className="text-sm text-destructive">
                      Não foi possível consultar os produtos desta loja:{" "}
                      {catalogoPedido.error.message}
                    </p>
                  )}
                  {config.table === "pedidos" && catalogoPedido.isPending && (
                    <p className="text-sm text-muted-foreground">Carregando produtos da loja…</p>
                  )}
                  <ProdutoPicker
                    produtos={produtosDisponiveis}
                    comprados={comprados.data ?? new Map()}
                    value={item.produto_id}
                    onPick={(id) => pickProduto(id)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Qtd</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={item.quantidade}
                    onChange={(e) => setItem((s) => ({ ...s, quantidade: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{config.itemPriceLabel}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={item.preco}
                    readOnly={!podeAlterarPreco || consultandoPreco}
                    title={podeAlterarPreco ? undefined : "Seu perfil não permite alterar o preço"}
                    onChange={(e) => setItem((s) => ({ ...s, preco: e.target.value }))}
                  />
                  {!podeAlterarPreco ? (
                    <p className="text-[11px] text-muted-foreground">
                      Preço definido pela tabela — seu perfil não permite alterar.
                    </p>
                  ) : null}
                  {promo !== null ? (
                    <p className="text-xs font-medium text-primary">
                      {promo.nome}: {brl(promo.preco)}
                      <br />
                      {promo.fim ? `Válida até ${fmtDate(promo.fim)}` : "Sem data limite"}
                    </p>
                  ) : null}
                </div>

                {config.itemsTable === "pedido_itens" ? (
                  <div className="space-y-1.5">
                    <Label>Desc. %</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.desconto}
                      onChange={(e) => setItem((s) => ({ ...s, desconto: e.target.value }))}
                    />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label>Lote</Label>
                      <Input
                        value={item.lote}
                        onChange={(e) => setItem((s) => ({ ...s, lote: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Validade</Label>
                      <Input
                        type="date"
                        value={item.validade}
                        onChange={(e) => setItem((s) => ({ ...s, validade: e.target.value }))}
                      />
                    </div>
                  </>
                )}
                <div className="flex items-end">
                  <Button
                    onClick={() => addItem.mutate()}
                    disabled={
                      addItem.isPending ||
                      consultandoPreco ||
                      (config.table === "pedidos" &&
                        (catalogoPedido.isPending || catalogoPedido.isError))
                    }
                  >
                    <Plus className="size-4" /> Item
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              {itens.isLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Carregando...</div>
              ) : (itens.data ?? []).length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum item lançado.
                </p>
              ) : (
                <Table className="mobile-cards">
                  <TableHeader>
                    <TableRow>
                      {config.table === "pedidos" && <TableHead>Código</TableHead>}
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">{config.itemPriceLabel}</TableHead>
                      <TableHead className="text-right">Peso</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itens.data!.map((it) => (
                      <TableRow key={String(it["id"])}>
                        {config.table === "pedidos" && (
                          <TableCell data-label="Código" className="font-mono">
                            {produtoCodigo(it["produto_id"])}
                          </TableCell>
                        )}
                        <TableCell data-label="Produto">{produtoName(it["produto_id"])}</TableCell>
                        <TableCell data-label="Quantidade" className="text-right">
                          {["rascunho", "digitacao"].includes(String(doc["status"])) &&
                          propostaEditavel ? (
                            <Input
                              aria-label={`Quantidade de ${produtoName(it["produto_id"])}`}
                              type="number"
                              step="0.001"
                              min="0"
                              className="ml-auto h-8 w-24 text-right"
                              defaultValue={String(it["quantidade"] ?? 0)}
                              onBlur={(e) => {
                                const qtd = Number(e.target.value || 0);
                                if (qtd > 0 && qtd !== Number(it["quantidade"])) {
                                  updateItem.mutate({
                                    id: String(it["id"]),
                                    values: { quantidade: qtd },
                                  });
                                }
                              }}
                            />
                          ) : (
                            String(it["quantidade"])
                          )}
                        </TableCell>
                        <TableCell data-label="Preço" className="text-right">
                          {["rascunho", "digitacao"].includes(String(doc["status"])) &&
                          propostaEditavel &&
                          podeAlterarPreco ? (
                            <Input
                              aria-label={`Preço de ${produtoName(it["produto_id"])}`}
                              type="number"
                              step="0.01"
                              min="0"
                              className="ml-auto h-8 w-28 text-right"
                              defaultValue={String(it[config.itemPriceField] ?? 0)}
                              onBlur={(e) => {
                                const preco = Number(e.target.value || 0);
                                if (preco !== Number(it[config.itemPriceField])) {
                                  updateItem.mutate({
                                    id: String(it["id"]),
                                    values: { [config.itemPriceField]: preco },
                                  });
                                }
                              }}
                            />
                          ) : (
                            brl(it[config.itemPriceField])
                          )}
                        </TableCell>
                        <TableCell data-label="Peso" className="text-right text-muted-foreground">
                          {kg(pesoItem(it))}
                        </TableCell>
                        <TableCell data-label="Total" className="text-right">
                          {brl(it["total"])}
                        </TableCell>
                        <TableCell data-label="Ações" className="text-right">
                          <Button
                            aria-label={`Remover ${produtoName(it["produto_id"])}`}
                            variant="ghost"
                            size="icon"
                            disabled={doc["status"] !== "rascunho" || !propostaEditavel}
                            onClick={() => removeItem.mutate(String(it["id"]))}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell
                        colSpan={config.table === "pedidos" ? 2 : 1}
                        className="font-semibold"
                      >
                        Peso total dos itens
                      </TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right font-semibold">{kg(pesoTotal)}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {brl(doc["total_itens"])}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </div>

            {config.table === "pedidos" && (
              <ProgressoDescontoPeso
                loja={lojaDocumento}
                carregando={itens.isPending || itens.isFetching}
                erro={itens.isError || (itens.data ?? []).some((it) => !it["produto_peso"])}
                itens={(itens.data ?? []).map((it) => {
                  const produto = it["produto_peso"] as {
                    peso_kg: number | null;
                    categoria: string | null;
                  } | null;
                  return {
                    quantidade: Number(it["quantidade"] ?? 0),
                    peso_kg: Number(produto?.peso_kg ?? 0),
                    categoria: produto?.categoria ?? null,
                  };
                })}
              />
            )}

            {config.table === "pedidos" && descontoPeso.data ? (
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">Desconto por peso (kg)</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Somamos o peso dos itens e comparamos com as faixas cadastradas em Descontos por
                  peso (kg).
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <Resumo
                    label="Peso total"
                    value={`${Number(descontoPeso.data.peso_total ?? 0).toLocaleString("pt-BR", {
                      maximumFractionDigits: 3,
                    })} kg`}
                  />
                  <Resumo label="Faixa" value={descontoPeso.data.faixa_nome ?? "Nenhuma faixa"} />
                  <Resumo
                    label="Desconto"
                    value={`${Number(descontoPeso.data.percentual ?? 0).toLocaleString("pt-BR")}%`}
                  />
                  <Resumo label="Valor" value={brl(descontoPeso.data.desconto_valor)} />
                </div>
                <Button
                  className="mt-3"
                  variant="secondary"
                  onClick={() => aplicarDescontoPeso.mutate()}
                  disabled={
                    !(
                      ["rascunho", "digitacao"].includes(String(doc["status"])) && propostaEditavel
                    ) ||
                    aplicarDescontoPeso.isPending ||
                    !canWrite
                  }
                >
                  {aplicarDescontoPeso.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {ehOrcamento ? "Aplicar desconto na proposta" : "Aplicar desconto no pedido"}
                </Button>
              </div>
            ) : null}

            {config.table === "pedidos" && (
              <EncargosPedido
                key={`encargos-${String(doc["id"])}`}
                doc={doc}
                editavel={
                  canWrite &&
                  propostaEditavel &&
                  ["rascunho", "digitacao"].includes(String(doc["status"]))
                }
                onPendente={setEncargosPendentes}
              />
            )}

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold">Forma de pagamento</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Define as parcelas, os vencimentos e o acréscimo ou desconto aplicado no total.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Forma</Label>
                  <select
                    value={pagamento["forma"] ?? String(doc["forma_pagamento_id"] ?? "")}
                    onChange={(e) => pickForma(e.target.value)}
                    disabled={doc["status"] !== "rascunho" || !propostaEditavel}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    {formas.data?.map((f) => (
                      <option key={String(f["id"])} value={String(f["id"])}>
                        {formaLabel(f)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>{config.table === "pedidos" ? "Frete manual (R$)" : "Frete (R$)"}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={doc["status"] !== "rascunho" || !propostaEditavel}
                    value={pagamento["frete"] ?? String(doc["frete_valor"] ?? 0)}
                    onChange={(e) => setPagamento((s) => ({ ...s, frete: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Desconto (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={doc["status"] !== "rascunho" || !propostaEditavel}
                    value={pagamento["desconto"] ?? String(doc["desconto_valor"] ?? 0)}
                    onChange={(e) => setPagamento((s) => ({ ...s, desconto: e.target.value }))}
                  />
                </div>
                {config.table === "pedidos" ? (
                  <div className="space-y-1.5">
                    <Label>Comissão (%)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      disabled={doc["status"] !== "rascunho" || !propostaEditavel}
                      value={pagamento["comissao"] ?? String(doc["comissao_percentual"] ?? 0)}
                      onChange={(e) => setPagamento((s) => ({ ...s, comissao: e.target.value }))}
                    />
                    {(() => {
                      const base = Math.max(
                        Number(doc["total_itens"] ?? 0) -
                          Number(pagamento["desconto"] ?? doc["desconto_valor"] ?? 0),
                        0,
                      );
                      const pct =
                        Number(
                          String(pagamento["comissao"] ?? doc["comissao_percentual"] ?? 0).replace(
                            ",",
                            ".",
                          ),
                        ) || 0;
                      const apurada = Math.round(base * pct) / 100;
                      return (
                        <p className="text-xs font-medium text-primary">
                          Comissão apurada: {brl(apurada)}{" "}
                          <span className="font-normal text-muted-foreground">
                            (base {brl(base)})
                          </span>
                        </p>
                      );
                    })()}
                  </div>
                ) : null}
              </div>
              {(config.table !== "pedidos" || pagamentoAlterado || savePagamento.isPending) && (
                <Button
                  className="mt-3"
                  onClick={() => savePagamento.mutate()}
                  disabled={
                    doc["status"] !== "rascunho" ||
                    !propostaEditavel ||
                    savePagamento.isPending ||
                    !canWrite
                  }
                >
                  {savePagamento.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {ehOrcamento ? "Salvar condições da proposta" : "Salvar pagamento"}
                </Button>
              )}

              {ehOrcamento && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Simulação dos prazos para aceite hoje. Os vencimentos reais serão definidos após a
                  conversão e confirmação do pedido.
                </p>
              )}
              {previaParcelas.length > 0 ? (
                <div className="mt-4 overflow-hidden rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">Parcela</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previaParcelas.map((p) => (
                        <TableRow key={p.parcela}>
                          <TableCell>
                            {String(doc?.["numero"] ?? "")}/{p.parcela}
                          </TableCell>

                          <TableCell>{p.vencimento}</TableCell>
                          <TableCell className="text-right">{brl(p.valor)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="mt-4 text-xs text-muted-foreground">
                  Escolha a forma de pagamento para ver as parcelas e vencimentos.
                </p>
              )}
            </div>
            {config.table === "pedidos" && <MargemPedido key={String(doc["id"])} pedido={doc} />}
            {config.table === "pedidos" && fechamentoDocumento}
            {config.table === "pedidos" && (
              <OrcamentoPedido
                key={`orcamento-${String(doc["id"])}`}
                doc={doc}
                pendente={edicaoPendente || pagamentoAlterado || itens.isFetching}
              />
            )}
          </>
        )}
      </section>

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {config.table === "compras"
                ? "Nova compra"
                : header["natureza"] === "orcamento"
                  ? "Novo orçamento"
                  : "Novo pedido"}
            </DialogTitle>
            <DialogDescription>
              1) {config.partnerLabel} e centro · 2) itens · 3) forma de pagamento.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {config.table === "pedidos" && header["natureza"] === "orcamento" && (
              <label className="text-sm sm:col-span-2">
                Validade do orçamento
                <Input
                  type="date"
                  min={header["data"] || hoje}
                  value={header["validade"] || ""}
                  onChange={(e) => setHeader((h) => ({ ...h, validade: e.target.value }))}
                />
              </label>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{config.partnerLabel}</Label>
              <select
                value={header["partner"] ?? ""}
                onChange={(e) => pickPartner(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">—</option>
                {partners.data?.map((p) => (
                  <option key={String(p["id"])} value={String(p["id"])}>
                    {String(p["razao_social"])}
                  </option>
                ))}
              </select>
            </div>
            {clienteFoco ? <div className="sm:col-span-2">{creditoPainel}</div> : null}

            <div className="space-y-1.5">
              <Label>Centro{config.table === "pedidos" ? " *" : ""}</Label>
              <select
                value={header["centro"] ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, centro: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">—</option>
                {centros.data?.map((c) => (
                  <option key={String(c["id"])} value={String(c["id"])}>
                    {String(c["nome"])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>
                {config.table === "pedidos" && header["natureza"] === "orcamento"
                  ? "Data da proposta"
                  : config.dateLabel}
              </Label>
              <Input
                type="date"
                value={header["data"] ?? hojeSaoPaulo()}
                onChange={(e) => setHeader((h) => ({ ...h, data: e.target.value }))}
              />
            </div>
            {config.table === "compras" ? (
              <>
                <div className="space-y-1.5">
                  <Label>NF número</Label>
                  <Input
                    value={header["nf"] ?? ""}
                    onChange={(e) => setHeader((h) => ({ ...h, nf: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Chave de acesso da NF-e</Label>
                  <Input
                    value={header["chave"] ?? ""}
                    onChange={(e) => setHeader((h) => ({ ...h, chave: e.target.value }))}
                    placeholder="44 dígitos"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Valor de impostos (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={header["impostos"] ?? ""}
                    onChange={(e) => setHeader((h) => ({ ...h, impostos: e.target.value }))}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Representante / vendedor</Label>
                  <select
                    value={header["representante"] ?? meuRepresentante}
                    onChange={(e) => setHeader((h) => ({ ...h, representante: e.target.value }))}
                    disabled={
                      !!meuRepresentante && !roles.includes("admin") && !roles.includes("gestor")
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    {representantes.data?.map((r) => (
                      <option key={String(r["id"])} value={String(r["id"])}>
                        {String(r["nome"])}
                        {r["profile_id"] ? " (com login)" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    Vem do login quando o usuário está vinculado a um representante.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Rota de entrega *</Label>
                  <select
                    value={header["rota"] ?? ""}
                    onChange={(e) => setHeader((h) => ({ ...h, rota: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    {rotas.data?.map((r) => (
                      <option key={String(r["id"])} value={String(r["id"])}>
                        {String(r["nome"])}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Forma de pagamento *</Label>
                  <select
                    value={header["forma"] ?? ""}
                    onChange={(e) => setHeader((h) => ({ ...h, forma: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    {formas.data?.map((f) => (
                      <option key={String(f["id"])} value={String(f["id"])}>
                        {formaLabel(f)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Previsão de entrega</Label>
                  <Input
                    type="date"
                    value={header["previsao"] ?? ""}
                    onChange={(e) => setHeader((h) => ({ ...h, previsao: e.target.value }))}
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Observações</Label>
              <Input
                value={header["observacoes"] ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, observacoes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenNew(false)}>
              Cancelar
            </Button>
            <Button onClick={() => createDoc.mutate()} disabled={createDoc.isPending}>
              {createDoc.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Busca de produto por código ou nome, com lista filtrada. */
function ProdutoPicker({
  produtos,
  comprados,
  value,
  onPick,
}: {
  produtos: Row[];
  comprados: Map<string, number>;
  value: string;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState(false);
  const sel = produtos.find((p) => String(p["id"]) === value);
  const rotulo = sel ? `${String(sel["codigo"] ?? "")} · ${String(sel["descricao"])}` : "";
  const termo = q.trim().toLowerCase();
  const lista = (
    termo
      ? produtos.filter(
          (p) =>
            String(p["descricao"]).toLowerCase().includes(termo) ||
            String(p["codigo"] ?? "")
              .toLowerCase()
              .includes(termo),
        )
      : produtos
  ).slice(0, 50);

  return (
    <div className="relative">
      <Input
        className="h-9"
        value={aberto ? q : rotulo}
        placeholder="Buscar por código ou nome"
        onFocus={() => {
          setQ("");
          setAberto(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setAberto(true);
        }}
        onBlur={() => window.setTimeout(() => setAberto(false), 150)}
      />
      {aberto ? (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {lista.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Nenhum produto encontrado.</p>
          ) : (
            lista.map((p) => (
              <button
                key={String(p["id"])}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(String(p["id"]));
                  setAberto(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="truncate">
                  <span className="font-semibold">{String(p["codigo"] ?? "—")}</span> ·{" "}
                  {String(p["descricao"])}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  est. {String(p["estoque_atual"] ?? 0)}
                  {(comprados.get(String(p["id"])) ?? 0) > 0 ? (
                    <span className="ml-2 font-semibold text-primary">
                      C {comprados.get(String(p["id"]))}
                    </span>
                  ) : null}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function Resumo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
