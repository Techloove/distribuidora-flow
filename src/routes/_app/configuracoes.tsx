import { DiagnosticoIntegridade } from "@/components/diagnostico-integridade";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ErpLayout } from "@/components/erp-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Dados da empresa emitente e parâmetros do sistema, como prazo padrão e desconto máximo.",
      },
      { property: "og:title", content: "Configurações — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Empresa emitente e parâmetros operacionais do ERP.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConfiguracoesPage,
});

type Row = Record<string, unknown>;

const campos = [
  { name: "razao_social", label: "Razão social", span: 2 },
  { name: "nome_fantasia", label: "Nome fantasia", span: 2 },
  { name: "cnpj", label: "CNPJ" },
  { name: "inscricao_estadual", label: "Inscrição estadual" },
  { name: "email", label: "E-mail" },
  { name: "telefone", label: "Telefone" },
  { name: "logradouro", label: "Logradouro", span: 2 },
  { name: "numero", label: "Número" },
  { name: "bairro", label: "Bairro" },
  { name: "cidade", label: "Cidade" },
  { name: "uf", label: "UF" },
  { name: "cep", label: "CEP" },
] as const;

function ConfiguracoesPage() {
  const { client, canManage, roles } = useSupabase();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [params, setParams] = useState<Record<string, string>>({});
  const empresa = useQuery({
    queryKey: ["empresas", "principal"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("empresas")
        .select("*")
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as Row | null;
    },
  });

  const parametros = useQuery({
    queryKey: ["parametros"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("parametros").select("*").order("chave");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  useEffect(() => {
    if (empresa.data) {
      const next: Record<string, string> = {};
      for (const c of campos) next[c.name] = String(empresa.data[c.name] ?? "");
      setForm(next);
    }
  }, [empresa.data]);

  useEffect(() => {
    if (parametros.data) {
      const next: Record<string, string> = {};
      for (const p of parametros.data) next[String(p["chave"])] = String(p["valor"] ?? "");
      setParams(next);
    }
  }, [parametros.data]);

  const salvarEmpresa = useMutation({
    mutationFn: async () => {
      if (!form["razao_social"]?.trim()) throw new Error("Informe a razão social");
      const payload: Record<string, string | null> = {};
      for (const c of campos) payload[c.name] = form[c.name]?.trim() || null;
      payload["razao_social"] = form["razao_social"]!.trim();

      if (empresa.data) {
        const { error } = await client!
          .from("empresas")
          .update(payload as never)
          .eq("id", empresa.data["id"] as string);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await client!.from("empresas").insert(payload as never);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success("Dados da empresa salvos");
      queryClient.invalidateQueries({ queryKey: ["empresas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarParametros = useMutation({
    mutationFn: async () => {
      if (
        params["comissao_fato_gerador"] &&
        !["venda", "recebimento"].includes(params["comissao_fato_gerador"])
      )
        throw new Error("Fato gerador da comissão inválido");
      if (
        params["margem_liquida_minima"] !== undefined &&
        (!Number.isFinite(Number(params["margem_liquida_minima"])) ||
          Number(params["margem_liquida_minima"]) < 0 ||
          Number(params["margem_liquida_minima"]) > 100)
      )
        throw new Error("Margem mínima deve estar entre 0 e 100");
      const rows = Object.entries(params).map(([chave, valor]) => ({ chave, valor }));
      if (!rows.length) return;
      const { error } = await client!.from("parametros").upsert(rows, { onConflict: "chave" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Parâmetros salvos");
      queryClient.invalidateQueries({ queryKey: ["parametros"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ErpLayout
      title="Configurações"
      description="Empresa emitente das notas e parâmetros usados nos pedidos, financeiro e alertas."
    >
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Empresa</h2>
          {empresa.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : empresa.isError ? (
            <p className="py-6 text-sm text-destructive">{(empresa.error as Error).message}</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {campos.map((c) => (
                <div key={c.name} className={"span" in c && c.span === 2 ? "sm:col-span-2" : ""}>
                  <Label htmlFor={`sicredi-${c.name}`}>{c.label}</Label>
                  <Input
                    value={form[c.name] ?? ""}
                    disabled={!canManage}
                    onChange={(e) => setForm((f) => ({ ...f, [c.name]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="sm:col-span-2">
                <Button
                  disabled={!canManage || salvarEmpresa.isPending}
                  onClick={() => salvarEmpresa.mutate()}
                >
                  <Save className="size-4" /> Salvar empresa
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Parâmetros do sistema</h2>
          {parametros.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : parametros.isError ? (
            <div className="py-6 text-sm text-destructive">
              {(parametros.error as Error).message}
              <p className="mt-2 text-xs text-muted-foreground">
                Rode <code>db/fase7_precos_devolucoes_metas_config.sql</code> no SQL Editor do
                Supabase.
              </p>
            </div>
          ) : (parametros.data ?? []).length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">Nenhum parâmetro cadastrado.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {parametros.data!.map((p) => {
                const chave = String(p["chave"]);
                const isBool = [
                  "exigir_nf_carga",
                  "exigir_nf_boleto",
                  "aprovacao_limite_credito",
                  "aprovacao_titulos_vencidos",
                  "vencimento_fim_semana_feriado",
                  "alerta_estoque_minimo",
                ].includes(chave);
                return (
                  <div key={chave}>
                    <Label>{String(p["descricao"] ?? chave)}</Label>
                    {chave === "comissao_fato_gerador" ? (
                      <select
                        aria-label="Fato gerador da comissão"
                        className="h-9 w-full rounded border bg-background px-3 text-sm"
                        value={params[chave] ?? "venda"}
                        disabled={!canManage}
                        onChange={(e) => setParams((f) => ({ ...f, [chave]: e.target.value }))}
                      >
                        <option value="venda">Venda</option>
                        <option value="recebimento">Recebimento integral do pedido</option>
                      </select>
                    ) : isBool ? (
                      <select
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={params[chave] ?? "true"}
                        disabled={!canManage}
                        onChange={(e) => setParams((f) => ({ ...f, [chave]: e.target.value }))}
                      >
                        <option value="true">Sim</option>
                        <option value="false">Não</option>
                      </select>
                    ) : (
                      <Input
                        type={chave === "margem_liquida_minima" ? "number" : "text"}
                        min={chave === "margem_liquida_minima" ? 0 : undefined}
                        max={chave === "margem_liquida_minima" ? 100 : undefined}
                        step={chave === "margem_liquida_minima" ? "0.01" : undefined}
                        value={params[chave] ?? ""}
                        disabled={!canManage}
                        onChange={(e) => setParams((f) => ({ ...f, [chave]: e.target.value }))}
                      />
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">{chave}</p>
                  </div>
                );
              })}
              <Button
                disabled={!canManage || salvarParametros.isPending}
                onClick={() => salvarParametros.mutate()}
              >
                <Save className="size-4" /> Salvar parâmetros
              </Button>
            </div>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-lg border bg-card p-5">
        <h2 className="text-sm font-semibold">Cobrança por centro de custo</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Configure banco, integração e regras de boletos no cadastro de Centros de custo. A emissão
          usa o centro do pedido ou da conta a receber.
        </p>
        <Link to="/centros" className="mt-3 inline-block text-sm font-medium underline">
          Configurar cobrança nos centros de custo
        </Link>
      </section>
      {roles.includes("admin") && <LimparDados />}
      <DiagnosticoIntegridade />
    </ErpLayout>
  );
}

function LimparDados() {
  const { client } = useSupabase();
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const limpar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("admin_limpar_dados", { _confirmacao: texto });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Dados apagados. O sistema está pronto para um novo cadastro.");
      setTexto("");
      queryClient.clear();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="mt-6 rounded-lg border border-destructive/50 bg-card p-5">
      <h2 className="text-sm font-semibold text-destructive">Limpar dados do sistema</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Apaga todos os cadastros e movimentações: clientes, pessoas, fornecedores, produtos, rotas,
        pedidos, compras, notas, cargas, estoque, financeiro e comissões. Mantém usuários, papéis,
        centros de custo, dados da empresa, parâmetros, Sicredi, plano de contas, formas de
        pagamento e faixas de desconto. Esta ação não pode ser desfeita.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="confirmar-limpeza">Digite LIMPAR para confirmar</Label>
          <Input
            id="confirmar-limpeza"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="LIMPAR"
          />
        </div>
        <Button
          variant="destructive"
          disabled={texto !== "LIMPAR" || limpar.isPending}
          onClick={() => {
            if (confirm("Tem certeza? Todos os dados serão apagados definitivamente."))
              limpar.mutate();
          }}
        >
          {limpar.isPending && <Loader2 className="size-4 animate-spin" />} Apagar todos os dados
        </Button>
      </div>
    </section>
  );
}
