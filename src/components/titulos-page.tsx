import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { brl } from "@/components/documento-page";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
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
  /** View com saldo e status efetivo (vencido/parcial) calculados no banco. */
  view: "vw_titulos_receber" | "vw_titulos_pagar";
  /** RPC completa de baixa (conta, forma de pagamento, juros, multa, desconto). */
  rpcBaixa: "receber_titulo" | "pagar_titulo";
  partnerTable: "clientes" | "fornecedores";
  partnerKey: "cliente_id" | "fornecedor_id";
  partnerLabel: string;
  rpc: "baixar_receber" | "baixar_pagar";
  baixaLabel: string;
  /** RPC de lançamento manual do título (com parcelamento). */
  rpcCriar: "criar_receita" | "criar_despesa";
};

const hoje = () => new Date().toISOString().slice(0, 10);

const novoTituloVazio = {
  parceiro: "",
  documento: "",
  descricao: "",
  valor: "",
  parcelas: "1",
  vencimento: hoje(),
  intervalo: "30",
  categoria: "",
  centro: "",
  conta: "",
  forma: "",
};

const statuses = ["todos", "aberto", "vencido", "parcial", "pago", "cancelado"] as const;

export function TitulosPage({ config }: { config: TitulosConfig }) {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof statuses)[number]>("aberto");
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));
  const [target, setTarget] = useState<Row | null>(null);
  const [valor, setValor] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [contaId, setContaId] = useState("");
  const [formaId, setFormaId] = useState("");
  const [juros, setJuros] = useState("");
  const [multa, setMulta] = useState("");
  const [descontoBaixa, setDescontoBaixa] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [openNovo, setOpenNovo] = useState(false);
  const [novo, setNovo] = useState({ ...novoTituloVazio });
  const setN = (k: keyof typeof novoTituloVazio, v: string) =>
    setNovo((s) => ({ ...s, [k]: v }));

  const canFinance =
    roles.includes("admin") || roles.includes("gestor") || roles.includes("financeiro");

  const titulos = useQuery({
    queryKey: [config.view],
    enabled: !!client,
    queryFn: async () => {
      const { data: rows, error } = await client!
        .from(config.view)
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

  const isReceber = config.table === "contas_receber";

  const contas = useQuery({
    queryKey: ["contas_financeiras", "titulos"],
    enabled: !!client,
    queryFn: async () => {
      const { data: rows, error } = await client!
        .from("contas_financeiras")
        .select("id, nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return (rows ?? []) as Row[];
    },
  });

  const formas = useQuery({
    queryKey: ["formas_pagamento", "titulos"],
    enabled: !!client,
    queryFn: async () => {
      const { data: rows, error } = await client!
        .from("formas_pagamento")
        .select("id, nome")
        .order("nome");
      if (error) return [] as Row[];
      return (rows ?? []) as Row[];
    },
  });

  const centros = useQuery({
    queryKey: ["centros", "titulos"],
    enabled: !!client,
    queryFn: async () => {
      const { data: rows, error } = await client!.from("centros").select("id, nome").order("nome");
      if (error) return [] as Row[];
      return (rows ?? []) as Row[];
    },
  });

  const boletos = useQuery({
    queryKey: ["boletos", "por-conta"],
    enabled: !!client && isReceber,
    queryFn: async () => {
      const { data: rows, error } = await client!
        .from("boletos")
        .select("id, conta_receber_id, status, nosso_numero, linha_digitavel, created_at")
        .order("created_at");
      if (error) throw new Error(error.message);
      return (rows ?? []) as Row[];
    },
  });

  const boletoPorConta = useMemo(() => {
    const map = new Map<string, Row>();
    for (const b of boletos.data ?? []) {
      const key = String(b["conta_receber_id"] ?? "");
      if (!key) continue;
      if (String(b["status"]) === "cancelado" && map.has(key)) continue;
      map.set(key, b);
    }
    return map;
  }, [boletos.data]);

  const boletoLabel = (r: Row) => {
    if (!isReceber) return "—";
    const b = boletoPorConta.get(String(r["id"]));
    if (!b) return "Sem boleto";
    return String(b["status"] ?? "—");
  };

  const rows = useMemo(() => {
    let list = titulos.data ?? [];
    if (status !== "todos")
      list = list.filter((r) => (r["status_efetivo"] ?? r["status"]) === status);
    if (filtros["centro"]) list = list.filter((r) => r["centro_id"] === filtros["centro"]);
    if (filtros["conta"]) list = list.filter((r) => r["conta_financeira_id"] === filtros["conta"]);
    if (filtros["forma"]) list = list.filter((r) => r["forma_pagamento_id"] === filtros["forma"]);
    if (filtros["pgde"]) list = list.filter((r) => String(r["data_pagamento"] ?? "") >= filtros["pgde"]!);
    if (filtros["pgate"])
      list = list.filter(
        (r) => !!r["data_pagamento"] && String(r["data_pagamento"]) <= filtros["pgate"]!,
      );
    const f = filtros;
    if (isReceber && f["boleto"]) {
      list = list.filter((r) => {
        const b = boletoPorConta.get(String(r["id"]));
        if (f["boleto"] === "sem") return !b;
        return !!b && String(b["status"]) === f["boleto"];
      });
    }
    const hoje = new Date().toISOString().slice(0, 10);
    if (f["parceiro"])
      list = list.filter((r) => String(r[config.partnerKey] ?? "") === f["parceiro"]);
    if (f["de"]) list = list.filter((r) => String(r["vencimento"] ?? "") >= f["de"]!);
    if (f["ate"]) list = list.filter((r) => String(r["vencimento"] ?? "") <= f["ate"]!);
    if (f["situacao"] === "vencidos")
      list = list.filter(
        (r) =>
          String(r["vencimento"] ?? "") < hoje &&
          r["status"] !== "pago" &&
          r["status"] !== "cancelado",
      );
    if (f["situacao"] === "avencer")
      list = list.filter(
        (r) =>
          String(r["vencimento"] ?? "") >= hoje &&
          r["status"] !== "pago" &&
          r["status"] !== "cancelado",
      );
    if (f["min"])
      list = list.filter(
        (r) => Number(r["valor"] ?? 0) - Number(r["valor_pago"] ?? 0) >= Number(f["min"]),
      );
    if (f["max"])
      list = list.filter(
        (r) => Number(r["valor"] ?? 0) - Number(r["valor_pago"] ?? 0) <= Number(f["max"]),
      );
    const termo = (f["busca"] ?? "").trim().toLowerCase();
    if (termo) {
      list = list.filter((r) => {
        const nome = String(
          partners.data?.find((p) => p["id"] === r[config.partnerKey])?.["razao_social"] ?? "",
        ).toLowerCase();
        return String(r["documento"] ?? "").toLowerCase().includes(termo) || nome.includes(termo);
      });
    }
    return list;
  }, [titulos.data, status, filtros, partners.data, config.partnerKey, isReceber, boletoPorConta]);

  const totalFiltrado = rows.reduce(
    (s, r) => s + Number(r["valor"] ?? 0) - Number(r["valor_pago"] ?? 0),
    0,
  );

  const totals = useMemo(() => {
    const abertos = (titulos.data ?? []).filter((r) => r["status"] !== "pago" && r["status"] !== "cancelado");
    const hoje = new Date().toISOString().slice(0, 10);
    return {
      aberto: abertos.reduce((s, r) => s + Number(r["valor"] ?? 0) - Number(r["valor_pago"] ?? 0), 0),
      vencido: abertos
        .filter((r) => String(r["vencimento"]) < hoje)
        .reduce((s, r) => s + Number(r["valor"] ?? 0) - Number(r["valor_pago"] ?? 0), 0),
      pago: (titulos.data ?? []).reduce((s, r) => s + Number(r["valor_pago"] ?? 0), 0),
      hoje: abertos
        .filter((r) => String(r["vencimento"]) === hoje)
        .reduce((s, r) => s + Number(r["saldo"] ?? 0), 0),
      futuros: abertos
        .filter((r) => String(r["vencimento"]) > hoje)
        .reduce((s, r) => s + Number(r["saldo"] ?? 0), 0),
    };
  }, [titulos.data]);

  const baixar = useMutation({
    mutationFn: async () => {
      const v = Number(valor || 0);
      if (v <= 0) throw new Error("Informe o valor da baixa");
      const { error } = await client!.rpc(config.rpcBaixa, {
        _id: target!["id"],
        _valor: v,
        _data: data,
        _conta_id: contaId || null,
        _forma_id: formaId || null,
        _juros: Number(juros || 0),
        _multa: Number(multa || 0),
        _desconto: Number(descontoBaixa || 0),
        _observacao: null,
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

  const baixarLote = useMutation({
    mutationFn: async () => {
      if (selecionados.length === 0) throw new Error("Selecione os títulos");
      const { error } = await client!.rpc("baixar_titulos_lote", {
        _tabela: config.table,
        _ids: selecionados,
        _data: data,
        _conta_id: contaId || null,
        _forma_id: formaId || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(`${selecionados.length} título(s) baixado(s)`);
      setSelecionados([]);
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const partnerName = (id: unknown) =>
    String(partners.data?.find((p) => p["id"] === id)?.["razao_social"] ?? "—");

  return (
    <div className="space-y-4">
      <div className="no-print grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card label="Em aberto" value={brl(totals.aberto)} />
        <Card label="Vencido" value={brl(totals.vencido)} tone />
        <Card label={isReceber ? "Recebido" : "Pago"} value={brl(totals.pago)} />
        <Card label={isReceber ? "Vence hoje" : "Vence hoje"} value={brl(totals.hoje)} />
        <Card label="A vencer (futuro)" value={brl(totals.futuros)} />
      </div>

      <FilterBar
        onClear={() => setFiltros({})}
        extra={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => window.print()}>
              <Printer className="size-3.5" /> Imprimir
            </Button>
            <Button
              size="sm"
              disabled={!canFinance || selecionados.length === 0 || baixarLote.isPending}
              onClick={() => baixarLote.mutate()}
            >
              {baixarLote.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Baixar {selecionados.length} selecionado(s)
            </Button>
          </div>
        }
      >
        <FilterText
          label="Buscar"
          value={filtros["busca"] ?? ""}
          onChange={(v) => setF("busca", v)}
          placeholder={`Documento ou ${config.partnerLabel.toLowerCase()}`}
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
          label="Situação"
          value={filtros["situacao"] ?? ""}
          onChange={(v) => setF("situacao", v)}
          options={[
            { value: "vencidos", label: "Vencidos" },
            { value: "avencer", label: "A vencer" },
          ]}
        />
        <FilterText
          label="Vencimento de"
          type="date"
          value={filtros["de"] ?? ""}
          onChange={(v) => setF("de", v)}
        />
        <FilterText
          label="Vencimento até"
          type="date"
          value={filtros["ate"] ?? ""}
          onChange={(v) => setF("ate", v)}
        />
        <FilterText
          label="Saldo mínimo"
          type="number"
          value={filtros["min"] ?? ""}
          onChange={(v) => setF("min", v)}
        />
        <FilterText
          label="Saldo máximo"
          type="number"
          value={filtros["max"] ?? ""}
          onChange={(v) => setF("max", v)}
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
        <FilterSelect
          label="Banco/caixa"
          value={filtros["conta"] ?? ""}
          onChange={(v) => setF("conta", v)}
          options={(contas.data ?? []).map((c) => ({
            value: String(c["id"]),
            label: String(c["nome"]),
          }))}
        />
        <FilterSelect
          label="Forma de pagamento"
          value={filtros["forma"] ?? ""}
          onChange={(v) => setF("forma", v)}
          options={(formas.data ?? []).map((c) => ({
            value: String(c["id"]),
            label: String(c["nome"]),
          }))}
        />
        <FilterText
          label="Pagamento de"
          type="date"
          value={filtros["pgde"] ?? ""}
          onChange={(v) => setF("pgde", v)}
        />
        <FilterText
          label="Pagamento até"
          type="date"
          value={filtros["pgate"] ?? ""}
          onChange={(v) => setF("pgate", v)}
        />
        {isReceber ? (
          <FilterSelect
            label="Boleto"
            value={filtros["boleto"] ?? ""}
            onChange={(v) => setF("boleto", v)}
            options={[
              { value: "sem", label: "Sem boleto" },
              { value: "pendente", label: "Pendente" },
              { value: "em_processamento", label: "Em processamento" },
              { value: "registrado", label: "Registrado" },
              { value: "liquidado", label: "Liquidado" },
              { value: "baixado", label: "Baixado" },
              { value: "cancelado", label: "Cancelado" },
              { value: "erro", label: "Erro" },
            ]}
          />
        ) : null}
      </FilterBar>

      <div className="no-print flex flex-wrap gap-2">
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

      <p className="text-xs text-muted-foreground">
        {rows.length} título(s) · saldo {brl(totalFiltrado)}
      </p>

      <div className="print-area rounded-lg border border-border bg-card">
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
                <TableHead className="no-print w-8" />
                <TableHead>Documento</TableHead>
                <TableHead>{config.partnerLabel}</TableHead>
                <TableHead>Parc.</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Status</TableHead>
                {isReceber ? <TableHead>Boleto</TableHead> : null}
                <TableHead className="no-print text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={String(r["id"])}>
                  <TableCell className="no-print">
                    <input
                      type="checkbox"
                      aria-label="Selecionar título"
                      className="size-4"
                      disabled={
                        !canFinance ||
                        r["status"] === "pago" ||
                        r["status"] === "cancelado"
                      }
                      checked={selecionados.includes(String(r["id"]))}
                      onChange={(e) =>
                        setSelecionados((s) =>
                          e.target.checked
                            ? [...s, String(r["id"])]
                            : s.filter((id) => id !== String(r["id"])),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>{String(r["documento"] ?? "—")}</TableCell>
                  <TableCell>{partnerName(r[config.partnerKey])}</TableCell>
                  <TableCell>{String(r["parcela"])}</TableCell>
                  <TableCell>{String(r["vencimento"])}</TableCell>
                  <TableCell className="text-right">{brl(r["valor"])}</TableCell>
                  <TableCell className="text-right">{brl(r["valor_pago"])}</TableCell>
                  <TableCell className="text-right">{brl(r["saldo"])}</TableCell>
                  <TableCell>{String(r["status_efetivo"] ?? r["status"])}</TableCell>
                  {isReceber ? (
                    <TableCell>
                      <span
                        className={
                          boletoLabel(r) === "Sem boleto"
                            ? "text-muted-foreground"
                            : boletoLabel(r) === "erro"
                              ? "text-destructive"
                              : undefined
                        }
                      >
                        {boletoLabel(r)}
                      </span>
                      {boletoPorConta.get(String(r["id"]))?.["nosso_numero"] ? (
                        <span className="block text-xs text-muted-foreground">
                          {String(boletoPorConta.get(String(r["id"]))!["nosso_numero"])}
                        </span>
                      ) : null}
                    </TableCell>
                  ) : null}
                  <TableCell className="no-print text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canFinance || r["status"] === "pago" || r["status"] === "cancelado"}
                      onClick={() => {
                        setTarget(r);
                        setValor(String(Number(r["saldo"] ?? 0)));
                        setJuros("");
                        setMulta("");
                        setDescontoBaixa("");
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
              Saldo atual {brl(target?.["saldo"])}. A baixa gera movimentação no banco/caixa
              escolhido e atualiza fluxo de caixa, DRE e relatórios.
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
            <div className="space-y-1.5">
              <Label>Banco/caixa</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={contaId}
                onChange={(e) => setContaId(e.target.value)}
              >
                <option value="">Selecione</option>
                {(contas.data ?? []).map((c) => (
                  <option key={String(c["id"])} value={String(c["id"])}>
                    {String(c["nome"])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Forma de pagamento</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={formaId}
                onChange={(e) => setFormaId(e.target.value)}
              >
                <option value="">Selecione</option>
                {(formas.data ?? []).map((c) => (
                  <option key={String(c["id"])} value={String(c["id"])}>
                    {String(c["nome"])}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Juros</Label>
              <Input
                type="number"
                step="0.01"
                value={juros}
                onChange={(e) => setJuros(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Multa</Label>
              <Input
                type="number"
                step="0.01"
                value={multa}
                onChange={(e) => setMulta(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Desconto</Label>
              <Input
                type="number"
                step="0.01"
                value={descontoBaixa}
                onChange={(e) => setDescontoBaixa(e.target.value)}
              />
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
