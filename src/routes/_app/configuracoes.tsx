import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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

type CampoSicredi = {
  name: string;
  label: string;
  type?: "text" | "number" | "password";
  span?: number;
  hint?: string;
  options?: { value: string; label: string }[];
};

/** Campos conforme a API de cobranca do Sicredi. */
const gruposSicredi: { titulo: string; campos: CampoSicredi[] }[] = [
  {
    titulo: "Credenciais da API",
    campos: [
      { name: "api_key", label: "Chave de API (x-api-key)", span: 2 },
      { name: "username", label: "Usuário" },
      { name: "password", label: "Senha", type: "password" },
      { name: "cooperativa", label: "Cooperativa" },
      { name: "posto", label: "Posto" },
      { name: "codigo_beneficiario", label: "Código do beneficiário" },
      {
        name: "ambiente",
        label: "Ambiente",
        options: [
          { value: "homologacao", label: "Homologação (sandbox)" },
          { value: "producao", label: "Produção" },
        ],
      },
    ],
  },
  {
    titulo: "Boleto",
    campos: [
      {
        name: "tipo_cobranca",
        label: "Tipo de cobrança",
        options: [
          { value: "HIBRIDO", label: "Híbrido (boleto + PIX)" },
          { value: "NORMAL", label: "Normal (só boleto)" },
        ],
      },
      {
        name: "especie_documento",
        label: "Espécie do documento",
        options: [
          { value: "DUPLICATA_MERCANTIL_INDICACAO", label: "Duplicata mercantil" },
          { value: "DUPLICATA_SERVICO_INDICACAO", label: "Duplicata de serviço" },
          { value: "NOTA_PROMISSORIA", label: "Nota promissória" },
          { value: "OUTROS", label: "Outros" },
        ],
      },
      {
        name: "validade_apos_vencimento",
        label: "Validade após vencimento (dias)",
        type: "number",
        hint: "0 = padrão do banco",
      },
      { name: "informativo", label: "Informativo do boleto", span: 2 },
      { name: "mensagem", label: "Mensagem ao pagador", span: 2 },
    ],
  },
  {
    titulo: "Juros e multa",
    campos: [
      {
        name: "tipo_juro",
        label: "Tipo de juro",
        options: [
          { value: "ISENTO", label: "Isento" },
          { value: "PERCENTUAL", label: "Percentual ao mês" },
          { value: "VALOR", label: "Valor por dia" },
        ],
      },
      { name: "juros", label: "Juros (% mês ou valor/dia)", type: "number" },
      { name: "multa", label: "Multa (%)", type: "number" },
      {
        name: "dias_multa",
        label: "Multa após (dias do vencimento)",
        type: "number",
      },
    ],
  },
  {
    titulo: "Desconto",
    campos: [
      {
        name: "tipo_desconto",
        label: "Tipo de desconto",
        options: [
          { value: "NAO_TEM_DESCONTO", label: "Sem desconto" },
          { value: "VALOR", label: "Valor fixo" },
          { value: "PERCENTUAL", label: "Percentual" },
        ],
      },
      { name: "valor_desconto1", label: "Valor/percentual do desconto", type: "number" },
      { name: "dias_desconto1", label: "Desconto até (dias antes do venc.)", type: "number" },
    ],
  },
  {
    titulo: "Protesto / negativação",
    campos: [
      {
        name: "tipo_protesto",
        label: "Instrução",
        options: [
          { value: "SEM_PROTESTO", label: "Sem protesto" },
          { value: "PROTESTAR", label: "Protestar" },
          { value: "NEGATIVAR", label: "Negativar (Serasa)" },
        ],
      },
      { name: "dias_protesto", label: "Protestar após (dias)", type: "number" },
    ],
  },
];

const numericosSicredi = new Set([
  "juros",
  "multa",
  "dias_multa",
  "valor_desconto1",
  "dias_desconto1",
  "dias_protesto",
  "validade_apos_vencimento",
]);

function ConfiguracoesPage() {
  const { client, canManage } = useSupabase();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [params, setParams] = useState<Record<string, string>>({});
  const [sic, setSic] = useState<Record<string, string>>({});

  const sicredi = useQuery({
    queryKey: ["sicredi_config"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("sicredi_config")
        .select("*")
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as Row | null;
    },
  });

  useEffect(() => {
    const row = sicredi.data;
    const next: Record<string, string> = {};
    for (const g of gruposSicredi) {
      for (const c of g.campos) {
        const v = row?.[c.name];
        next[c.name] = String(v ?? (c.options ? (c.options[0]?.value ?? "") : ""));
      }
    }
    setSic(next);
  }, [sicredi.data]);

  const salvarSicredi = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string | number | null> = {};
      for (const g of gruposSicredi) {
        for (const c of g.campos) {
          const v = (sic[c.name] ?? "").trim();
          payload[c.name] = numericosSicredi.has(c.name) ? Number(v || 0) : v || null;
        }
      }
      if (sicredi.data) {
        const { error } = await client!
          .from("sicredi_config")
          .update(payload as never)
          .eq("id", sicredi.data["id"] as string);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await client!.from("sicredi_config").insert(payload as never);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success("Configuração Sicredi salva");
      queryClient.invalidateQueries({ queryKey: ["sicredi_config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


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
                  <Label>{c.label}</Label>
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
                return (
                  <div key={chave}>
                    <Label>{String(p["descricao"] ?? chave)}</Label>
                    <Input
                      value={params[chave] ?? ""}
                      disabled={!canManage}
                      onChange={(e) => setParams((f) => ({ ...f, [chave]: e.target.value }))}
                    />
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

      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Cobrança Sicredi (API de boletos)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Chaves de acesso do portal de parceiros e regras de juros, multa, desconto e protesto
          aplicadas em todo boleto emitido no Faturamento.
        </p>
        {sicredi.isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </div>
        ) : sicredi.isError ? (
          <div className="py-6 text-sm text-destructive">
            {(sicredi.error as Error).message}
            <p className="mt-2 text-xs text-muted-foreground">
              Rode <code>db/fase18_sicredi_config.sql</code> no banco.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {gruposSicredi.map((g) => (
              <div key={g.titulo}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.titulo}
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {g.campos.map((c) => (
                    <div key={c.name} className={c.span === 2 ? "sm:col-span-2" : ""}>
                      <Label>{c.label}</Label>
                      {c.options ? (
                        <select
                          value={sic[c.name] ?? ""}
                          disabled={!canManage}
                          onChange={(e) => setSic((f) => ({ ...f, [c.name]: e.target.value }))}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {c.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          type={c.type ?? "text"}
                          step={c.type === "number" ? "0.0001" : undefined}
                          value={sic[c.name] ?? ""}
                          disabled={!canManage}
                          onChange={(e) => setSic((f) => ({ ...f, [c.name]: e.target.value }))}
                        />
                      )}
                      {c.hint ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">{c.hint}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <Button
              disabled={!canManage || salvarSicredi.isPending}
              onClick={() => salvarSicredi.mutate()}
            >
              <Save className="size-4" /> Salvar configuração Sicredi
            </Button>
          </div>
        )}
      </section>
    </ErpLayout>
  );
}

