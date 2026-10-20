import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { gruposSicredi, numericosSicredi } from "@/lib/sicredi-campos";
import { sicrediConfigGet, sicrediConfigSave } from "@/lib/sicredi-config.functions";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";

type Banco = "indefinido" | "sicredi" | "sicoob";
export function CobrancaCentros() {
  const { client, user, roles } = useSupabase();
  const [centro, setCentro] = useState("");
  const centros = useQuery({
    queryKey: ["cobranca-centros", user?.id],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("centros")
        .select("id,nome")
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  if (!roles.some((r) => ["admin", "gestor"].includes(r))) return null;
  return (
    <section className="mt-6 rounded-xl border bg-card p-5" id="cobranca">
      <h2 className="font-semibold">Cobrança por loja</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Selecione Ferragem para vincular o Sicredi via API. Configure o outra loja separadamente; o
        Sicoob permanece pendente até definir a integração.
      </p>
      <div className="mt-4 max-w-lg">
        <Label htmlFor="cobranca-centro">Loja</Label>
        <select
          id="cobranca-centro"
          className="h-10 w-full rounded-md border bg-background px-3"
          value={centro}
          onChange={(e) => setCentro(e.target.value)}
        >
          <option value="">Selecione a loja</option>
          {centros.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>
      {centros.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {centros.error.message}
        </p>
      )}
      {centro && (
        <ConfiguracaoCentro
          key={centro}
          centro={centro}
          nome={centros.data?.find((c) => c.id === centro)?.nome ?? ""}
        />
      )}
    </section>
  );
}
function ConfiguracaoCentro({ centro, nome }: { centro: string; nome: string }) {
  const { client, user, session, roles } = useSupabase();
  const permissoes = usePermissoesRotinas();
  const editar = roles.includes("admin") && permissoes.pode("centros_cobranca_configurar");
  const qc = useQueryClient();
  const get = useServerFn(sicrediConfigGet),
    save = useServerFn(sicrediConfigSave);
  const [banco, setBanco] = useState<Banco>("indefinido"),
    [ativo, setAtivo] = useState(false),
    [conta, setConta] = useState("");
  const [sic, setSic] = useState<Record<string, string>>({});
  const config = useQuery({
    queryKey: ["sicredi_config_segura", user?.id, centro],
    enabled: !!session,
    queryFn: () => get({ data: { centro_id: centro, accessToken: session!.access_token } }),
  });
  const contas = useQuery({
    queryKey: ["cobranca-contas", user?.id, centro],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("contas_financeiras")
        .select("id,nome")
        .eq("ativo", true)
        .or(`centro_id.is.null,centro_id.eq.${centro}`)
        .order("nome");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  useEffect(() => {
    if (!config.data) return;
    const r = config.data;
    setBanco((r.cobranca?.["banco"] as Banco) ?? "indefinido");
    setAtivo(r.cobranca?.["ativo"] === true);
    setConta(String(r.cobranca?.["conta_financeira_id"] ?? ""));
    const next: Record<string, string> = {};
    for (const g of gruposSicredi)
      for (const c of g.campos) next[c.name] = String(r[c.name as keyof typeof r] ?? "");
    next["tipo_cobranca"] = "NORMAL";
    next["api_key"] = "";
    next["password"] = "";
    next["sandbox_api_key"] = "";
    setSic(next);
  }, [config.data]);
  const salvar = useMutation({
    mutationFn: () => {
      const payload: Record<string, string | number> = {};
      for (const g of gruposSicredi)
        for (const c of g.campos)
          payload[c.name] = numericosSicredi.has(c.name)
            ? Number(sic[c.name] || 0)
            : (sic[c.name] ?? "");
      return save({
        data: {
          ...payload,
          centro_id: centro,
          banco,
          ativo: banco === "sicredi" && ativo,
          conta_financeira_id: conta || null,
          accessToken: session!.access_token,
        },
      });
    },
    onSuccess: async () => {
      toast.success(`Cobrança de ${nome} salva`);
      setSic((s) => ({ ...s, api_key: "", sandbox_api_key: "", password: "" }));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sicredi_config_segura"] }),
        qc.invalidateQueries({ queryKey: ["sicredi", "status"] }),
        qc.invalidateQueries({ queryKey: ["cobranca-emissao"] }),
      ]);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (config.isPending)
    return (
      <p className="mt-4" role="status">
        Carregando configuração…
      </p>
    );
  if (config.isError)
    return (
      <p className="mt-4 text-sm text-destructive" role="alert">
        {config.error.message} Aplique a fase237 no Supabase.
      </p>
    );
  const disabled = !editar || salvar.isPending;
  return (
    <div className="mt-5 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="cobranca-banco">Banco de cobrança</Label>
          <select
            id="cobranca-banco"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={banco}
            disabled={disabled}
            onChange={(e) => {
              setBanco(e.target.value as Banco);
              setAtivo(false);
            }}
          >
            <option value="indefinido">Não definido</option>
            <option value="sicredi" disabled={!config.data?.convenio_disponivel}>
              Sicredi · API
            </option>
            <option value="sicoob">Sicoob · integração a definir</option>
          </select>
        </div>
        <div>
          <Label htmlFor="cobranca-conta">Conta financeira para recebimento</Label>
          <select
            id="cobranca-conta"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={conta}
            disabled={disabled || contas.isPending || contas.isError}
            onChange={(e) => setConta(e.target.value)}
          >
            <option value="">Selecione a conta</option>
            {contas.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
      </div>
      {contas.isError && (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar as contas financeiras.
        </p>
      )}
      {banco !== "sicredi" ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Emissão indisponível para este centro. A integração Sicoob será configurada após definir
          API ou CNAB; nenhum boleto será enviado ao Sicredi.
        </p>
      ) : (
        <>
          {config.data?.convenio_preservado && (
            <p className="rounded-lg border p-3 text-sm">
              Os dados Sicredi anteriores foram preservados. Ao salvar, o convênio será vinculado a
              este centro. Confira se selecionou Ferragem.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            API de Cobrança 4.0 · boleto normal. No sandbox, o sistema utiliza automaticamente os
            dados de teste do manual. Em produção, utiliza o convênio informado abaixo. A API
            fornece o nosso número; não é necessário cadastrar sequenciais CNAB.
          </p>
          {gruposSicredi.map((g) => (
            <fieldset key={g.titulo} disabled={disabled} className="space-y-3">
              <legend className="mb-2 text-sm font-semibold">{g.titulo}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {g.campos.map((c) => (
                  <div key={c.name} className={c.span === 2 ? "sm:col-span-2" : ""}>
                    <Label htmlFor={`sicredi-${c.name}`}>{c.label}</Label>
                    {c.options ? (
                      <select
                        id={`sicredi-${c.name}`}
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={sic[c.name] ?? ""}
                        onChange={(e) => setSic((s) => ({ ...s, [c.name]: e.target.value }))}
                      >
                        {c.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id={`sicredi-${c.name}`}
                        type={c.type ?? "text"}
                        autoComplete={c.type === "password" ? "new-password" : "off"}
                        step={
                          c.type === "number"
                            ? ["juros", "multa", "valor_desconto1"].includes(c.name)
                              ? "0.01"
                              : "1"
                            : undefined
                        }
                        min={c.type === "number" ? 0 : undefined}
                        value={sic[c.name] ?? ""}
                        onChange={(e) => setSic((s) => ({ ...s, [c.name]: e.target.value }))}
                      />
                    )}
                    {c.hint && <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
          <p className="text-xs text-muted-foreground">
            Chave sandbox: {config.data?.sandbox_api_key_configurada ? "cadastrada" : "pendente"} ·
            Chave produção: {config.data?.api_key_configurada ? "cadastrada" : "pendente"} · Código
            de acesso: {config.data?.password_configurada ? "cadastrado" : "pendente"}. Campos de
            segredo vazios mantêm os valores atuais.
          </p>
          <label className="flex items-center gap-2 rounded-lg border p-4 text-sm">
            <input
              type="checkbox"
              disabled={disabled}
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
            />
            Habilitar novas emissões Sicredi API para {nome}
          </label>
          <details className="rounded-lg border p-4 text-sm">
            <summary className="cursor-pointer font-medium">
              Como liberar as credenciais no Sicredi
            </summary>
            <ol className="mt-3 list-decimal space-y-2 pl-5">
              <li>
                Cadastre a aplicação de homologação com as APIs de autenticação e cobrança no Portal
                do Desenvolvedor.
              </li>
              <li>
                Solicite a chave de homologação pelo suporte, usando o Client ID da aplicação.
                Cadastre a chave no campo x-api-key do sandbox.
              </li>
              <li>
                Após validar os testes, crie a aplicação de produção e solicite sua chave própria.
              </li>
              <li>
                Gere o código de acesso no Internet Banking e preencha beneficiário, cooperativa,
                posto e usuário de produção (beneficiário + cooperativa).
              </li>
            </ol>
            <p className="mt-3 text-muted-foreground">
              O token OAuth é obtido e renovado pelo servidor. As chaves e o código de acesso não
              são exibidos após salvar.
            </p>
          </details>
        </>
      )}
      {!editar && (
        <p className="text-sm text-muted-foreground">
          Somente administradores autorizados podem alterar a cobrança.
        </p>
      )}
      <Button disabled={disabled || contas.isError} onClick={() => salvar.mutate()}>
        <Save className="size-4" />
        {salvar.isPending ? "Salvando…" : "Salvar cobrança deste centro"}
      </Button>
    </div>
  );
}
