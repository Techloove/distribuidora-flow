import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import { useCentro } from "@/lib/centro-store";
import { OCORRENCIAS, nomeRemessaHomologacao, type CnabConfig } from "@/lib/sicredi-cnab";
import {
  cnabImportarRetorno,
  cnabPreverRetorno,
  cnabSalvarConfig,
} from "@/lib/sicredi-cnab.functions";

type Row = Record<string, unknown>;
function download(content: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([Uint8Array.from(content, (char) => char.charCodeAt(0))], {
      type: "application/octet-stream",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type Mode = "configuracao" | "operacao";
export function SicrediCnabPanel({ mode = "operacao" }: { mode?: Mode }) {
  const { centro } = useCentro();
  const { roles } = useSupabase();
  if (!roles.some((r) => ["admin", "gestor", "financeiro"].includes(r))) return null;
  return (
    <section className="no-print rounded-xl border bg-card p-4">
      <h2 className="font-semibold">Sicredi · CNAB 240</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode === "configuracao"
          ? "Configure o convênio e as regras dos boletos por centro de custo."
          : "Confira os retornos do Sicredi e consulte os arquivos de cobrança."}
      </p>
      {!centro ? (
        <p className="mt-3 text-sm">
          Selecione um centro de custo específico no filtro superior para trabalhar com CNAB.
        </p>
      ) : (
        <CentroCnab key={centro} centro={centro} mode={mode} />
      )}
    </section>
  );
}
function CentroCnab({ centro, mode }: { centro: string; mode: Mode }) {
  const { client, session, roles } = useSupabase();
  const qc = useQueryClient();
  const admin = roles.includes("admin") || roles.includes("gestor");
  const save = useServerFn(cnabSalvarConfig),
    preview = useServerFn(cnabPreverRetorno),
    apply = useServerFn(cnabImportarRetorno);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState(""),
    [filename, setFilename] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof preview>> | null>(null);
  const [form, setForm] = useState<CnabConfig>({
    conta_financeira_id: "",
    categoria_tarifa_id: null,
    centro_id: centro,
    nome: "",
    documento: "",
    cooperativa: "",
    posto: "",
    beneficiario: "",
    conta: "",
    conta_dv: "",
    proxima_remessa: 1,
    proximo_nosso_numero: 1,
    homologado: false,
    juros_mensal: 0,
    multa_percentual: 0,
    tipo_cobranca: "NORMAL",
    chave_pix: null,
  });
  const input = () => ({ centro_id: centro, accessToken: session!.access_token });
  const accounts = useQuery({
    queryKey: ["cnab", "contas", centro],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("contas_financeiras")
        .select("id,nome")
        .eq("ativo", true)
        .or(`centro_id.eq.${centro},centro_id.is.null`)
        .order("nome");
      if (error) throw new Error("Não foi possível carregar as contas financeiras.");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const categories = useQuery({
    queryKey: ["cnab", "categorias"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("categorias_financeiras")
        .select("id,nome")
        .eq("tipo", "despesa")
        .order("nome");
      if (error) throw new Error("Não foi possível carregar as categorias de despesas.");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const cfg = useQuery({
    queryKey: ["cnab", "config", centro],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("sicredi_cnab_config")
        .select("*")
        .eq("centro_id", centro)
        .maybeSingle();
      if (error)
        throw new Error("Não foi possível carregar CNAB. Aplique a migração fase204 no Supabase.");
      return data as CnabConfig | null;
    },
  });
  useEffect(() => {
    if (cfg.data) setForm(cfg.data);
  }, [cfg.data]);
  const history = useQuery({
    queryKey: ["cnab", "arquivos", centro],
    enabled: !!client && !!cfg.data && mode === "operacao",
    queryFn: async () => {
      const { data, error } = await client!
        .from("sicredi_cnab_arquivos")
        .select("id,tipo,nome,quantidade,created_at")
        .eq("centro_id", centro)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });
  async function run(fn: () => Promise<void>) {
    if (busy || !session) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na rotina CNAB.");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["cnab"] }),
      qc.invalidateQueries({ queryKey: ["boletos"] }),
      qc.invalidateQueries({ queryKey: ["vw_boletos_pendentes"] }),
      qc.invalidateQueries({ queryKey: ["contas_receber"] }),
    ]);
  }
  const textFields: [keyof CnabConfig, string][] = [
    ["nome", "Nome do beneficiário (até 30 caracteres)"],
    ["documento", "CPF/CNPJ do beneficiário"],
    ["cooperativa", "Cooperativa (4 dígitos)"],
    ["posto", "Posto (2 dígitos)"],
    ["beneficiario", "Código do beneficiário (5 dígitos)"],
    ["conta", "Conta corrente sem DV"],
    ["conta_dv", "Dígito da conta"],
  ];
  const numberFields: [keyof CnabConfig, string][] = [
    ["proxima_remessa", "Próximo sequencial de remessa"],
    ["proximo_nosso_numero", "Próximo sequencial de nosso número"],
    ["juros_mensal", "Juros mensais (%)"],
    ["multa_percentual", "Multa (%)"],
  ];
  return (
    <div className="mt-4 space-y-4">
      {cfg.isError && (
        <p role="alert" className="text-sm text-destructive">
          {cfg.error.message}
        </p>
      )}
      {cfg.isLoading && <p role="status">Carregando CNAB…</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {mode === "configuracao" && (
        <details open>
          <summary className="cursor-pointer text-sm font-medium">
            Configuração CNAB deste centro
          </summary>
          <p className="my-3 text-sm text-muted-foreground">
            Manual Sicredi 3.0 (05/2026), layout 081/040, carteira simples, emissão pelo Sicredi e
            distribuição pelo beneficiário. Os parâmetros da API são independentes. Confira os
            sequenciais já utilizados com a cooperativa antes da primeira remessa.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await save({ data: { ...input(), config: form } });
                await refresh();
                toast.success("Configuração CNAB salva.");
              });
            }}
          >
            <fieldset
              disabled={!admin || busy || cfg.isLoading || cfg.isError}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              {textFields.map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`cnab-${key}`}>{label}</Label>
                  <Input
                    id={`cnab-${key}`}
                    required
                    value={String(form[key])}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </div>
              ))}
              <div className="space-y-1">
                <Label htmlFor="cnab-conta-financeira">Conta financeira dos recebimentos</Label>
                <select
                  id="cnab-conta-financeira"
                  className="h-10 w-full rounded-md border bg-background px-2"
                  required
                  value={form.conta_financeira_id}
                  onChange={(e) => setForm({ ...form, conta_financeira_id: e.target.value })}
                >
                  <option value="">Selecione a conta Sicredi</option>
                  {(accounts.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nome}
                    </option>
                  ))}
                </select>
                {accounts.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {accounts.error.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="cnab-categoria-tarifa">Categoria das tarifas bancárias</Label>
                <select
                  id="cnab-categoria-tarifa"
                  className="h-10 w-full rounded-md border bg-background px-2"
                  value={form.categoria_tarifa_id ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, categoria_tarifa_id: e.target.value || null })
                  }
                >
                  <option value="">Selecione para conciliar tarifas</option>
                  {(categories.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nome}
                    </option>
                  ))}
                </select>
                {categories.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {categories.error.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="cnab-tipo">Tipo de boleto</Label>
                <select
                  id="cnab-tipo"
                  className="h-10 w-full rounded-md border bg-background px-2"
                  value={form.tipo_cobranca ?? "NORMAL"}
                  onChange={(e) =>
                    setForm({ ...form, tipo_cobranca: e.target.value as "NORMAL" | "HIBRIDO" })
                  }
                >
                  <option value="NORMAL">Boleto normal</option>
                  <option value="HIBRIDO">Boleto híbrido com PIX</option>
                </select>
              </div>
              {form.tipo_cobranca === "HIBRIDO" && (
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="cnab-pix">
                    Chave PIX aleatória vinculada ao convênio Sicredi
                  </Label>
                  <Input
                    id="cnab-pix"
                    required
                    value={form.chave_pix ?? ""}
                    onChange={(e) => setForm({ ...form, chave_pix: e.target.value.trim() })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Confirme a contratação do boleto híbrido com a cooperativa. O QR Code fica
                    disponível após importar o retorno de registro com os dados PIX.
                  </p>
                </div>
              )}
              {numberFields.map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`cnab-${key}`}>{label}</Label>
                  <Input
                    id={`cnab-${key}`}
                    type="number"
                    min={key.includes("percentual") || key === "juros_mensal" ? 0 : 1}
                    step={key.includes("percentual") || key === "juros_mensal" ? "0.01" : "1"}
                    required
                    value={Number(form[key])}
                    onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                  />
                </div>
              ))}
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.homologado}
                  onChange={(e) => setForm({ ...form, homologado: e.target.checked })}
                />
                A cooperativa confirmou a homologação CNAB deste convênio.
              </label>
              {admin && (
                <Button type="submit" className="w-fit">
                  Salvar configuração CNAB
                </Button>
              )}
            </fieldset>
          </form>
          {!admin && (
            <p className="mt-2 text-sm">A configuração é feita pelo administrador ou gestor.</p>
          )}
        </details>
      )}
      {mode === "operacao" && !cfg.isLoading && !cfg.isError && !cfg.data && (
        <p className="text-sm">
          Convênio CNAB não configurado para este centro. Solicite a configuração ao administrador
          em{" "}
          <Link to="/configuracoes" className="underline">
            Configurações do sistema
          </Link>
          .
        </p>
      )}
      {mode === "operacao" && cfg.data && (
        <>
          {!cfg.data.homologado && (
            <p className="rounded-md border p-3 text-sm">
              Convênio em homologação. Emita pelos pedidos e envie a remessa para validação com a
              cooperativa. A aplicação de retornos ficará disponível após confirmar a homologação.
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Importar retorno CNAB 240
            </summary>
            <Label htmlFor="cnab-retorno" className="mt-3 block">
              Arquivo de retorno fornecido pelo Sicredi (até 2 MB)
            </Label>
            <Input
              id="cnab-retorno"
              className="mt-2"
              type="file"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                setResult(null);
                setConfirmed(false);
                setContent("");
                setFilename("");
                if (!file) return;
                void run(async () => {
                  if (file.size > 2_000_000) throw new Error("Arquivo excede 2 MB.");
                  const text = new TextDecoder("windows-1252").decode(await file.arrayBuffer());
                  const parsed = await preview({ data: { ...input(), content: text } });
                  setContent(text);
                  setFilename(file.name);
                  setResult(parsed);
                });
              }}
            />
            {result && (
              <>
                <div className="mt-3 max-h-72 overflow-auto rounded-md border">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th className="p-2">Nosso número</th>
                        <th>Ocorrência</th>
                        <th>Recebido</th>
                        <th>Vencimento</th>
                        <th>Conferência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.eventos.map((e, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{e.nosso_numero}</td>
                          <td>
                            {OCORRENCIAS[e.ocorrencia] ??
                              `Ocorrência ${e.ocorrencia}: registrada sem alterar títulos`}
                          </td>
                          <td>R$ {e.valor_recebido}</td>
                          <td>{e.vencimento ?? "—"}</td>
                          <td>
                            {e.problema ?? `Localizado · ${e.status_atual}`}
                            {e.motivos && ` · motivos ${e.motivos}`}
                            {e.pix?.url && " · QR Code PIX recebido"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="my-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  Confirmo que o arquivo veio do Sicredi e conferi os valores e ocorrências.
                </label>
                <Button
                  disabled={
                    busy ||
                    !confirmed ||
                    !result.homologado ||
                    result.eventos.some((e) => e.problema)
                  }
                  onClick={() =>
                    void run(async () => {
                      await apply({
                        data: { ...input(), content, filename, confirmado: confirmed },
                      });
                      setResult(null);
                      setContent("");
                      setConfirmed(false);
                      await refresh();
                      toast.success("Retorno aplicado. Reimportações não duplicam recebimentos.");
                    })
                  }
                >
                  Aplicar retorno conferido
                </Button>
              </>
            )}
          </details>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Últimos arquivos e download
            </summary>
            {history.isError && <p role="alert">{history.error.message}</p>}
            {(history.data ?? []).map((a) => (
              <div
                key={String(a["id"])}
                className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  {String(a["tipo"])} · {String(a["nome"])} · {String(a["quantidade"])} títulos ·{" "}
                  {new Date(String(a["created_at"])).toLocaleString("pt-BR")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const { data, error } = await client!
                        .from("sicredi_cnab_arquivos")
                        .select("conteudo,nome")
                        .eq("id", a["id"])
                        .eq("centro_id", centro)
                        .single();
                      if (error) throw new Error("Não foi possível recuperar o arquivo.");
                      download(String(data.conteudo), String(data.nome));
                    })
                  }
                >
                  Baixar arquivo
                </Button>
                {a["tipo"] === "remessa" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const { data, error } = await client!
                          .from("sicredi_cnab_arquivos")
                          .select("conteudo,nome")
                          .eq("id", a["id"])
                          .eq("centro_id", centro)
                          .single();
                        if (error) throw new Error("Não foi possível recuperar a remessa.");
                        download(
                          String(data.conteudo),
                          nomeRemessaHomologacao(String(data.nome), String(data.conteudo)),
                        );
                        toast.info(
                          "Cópia para homologação. Nenhum título ou sequencial novo foi gerado.",
                        );
                      })
                    }
                  >
                    Baixar .CRM para homologação
                  </Button>
                )}
              </div>
            ))}
          </details>
        </>
      )}
    </div>
  );
}
