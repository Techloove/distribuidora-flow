import { ProvedorFiscalLoja } from "@/components/provedor-fiscal-loja";
import { FiscalLoja } from "@/components/fiscal-loja";
import { FreteVolumeLoja } from "@/components/frete-volume-loja";
import { Link } from "@tanstack/react-router";
import { setCentro } from "@/lib/centro-store";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CatalogoLoja } from "@/components/catalogo-loja";
import { CobrancaCentros } from "@/components/cobranca-centros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCentrosPermitidos } from "@/lib/centros-acesso";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { useSupabase } from "@/lib/supabase-provider";

type Parametro = { chave: string; valor: string | null; descricao: string | null };
const campos: Record<string, { label: string; tipo: "boolean" | "number" | "comissao" }> = {
  intermediacao_habilitada: {
    label: "Habilitar vendas por intermediação (entrega direta da fábrica)",
    tipo: "boolean",
  },
  aprovacao_limite_credito: {
    label: "Exigir aprovação ao ultrapassar o limite de crédito",
    tipo: "boolean",
  },
  aprovacao_titulos_vencidos: {
    label: "Exigir aprovação para clientes com parcelas vencidas",
    tipo: "boolean",
  },
  vencimento_fim_semana_feriado: {
    label: "Considerar próximo dia útil na análise de atraso",
    tipo: "boolean",
  },
  tolerancia_dias_vencidos: { label: "Tolerância de atraso (dias)", tipo: "number" },
  margem_minima: { label: "Acréscimo mínimo sobre o custo — venda do estoque (%)", tipo: "number" },
  margem_liquida_minima: {
    label: "Margem de contribuição mínima — venda do estoque (%)",
    tipo: "number",
  },
  desconto_maximo: { label: "Desconto máximo nos itens (%)", tipo: "number" },
  comissao_fato_gerador: { label: "Liberar comissão por", tipo: "comissao" },
  exigir_nf_carga: { label: "Exigir nota fiscal para a carga", tipo: "boolean" },
  exigir_nf_boleto: { label: "Exigir nota fiscal para boleto", tipo: "boolean" },
};

export function ConfiguracaoLoja({
  lojaInicial = "",
  cidadeInicial = "",
}: {
  lojaInicial?: string;
  cidadeInicial?: string;
}) {
  const { client, user, canManage } = useSupabase();
  const acesso = useCentrosPermitidos();
  const permissoes = usePermissoesRotinas();
  const [loja, setLoja] = useState(lojaInicial);
  const valida = acesso.lista.some((l) => l.id === loja) ? loja : "";
  return (
    <section className="mt-6 rounded-xl border bg-card p-5 space-y-4">
      <h2 className="font-semibold">Configurações da loja</h2>
      <p className="text-sm text-muted-foreground">
        Escolha a loja para configurar suas regras e cobrança. As configurações iniciais foram
        copiadas do sistema e podem ser personalizadas separadamente.
      </p>
      <Label htmlFor="configuracao-loja">Loja</Label>
      <select
        id="configuracao-loja"
        className="h-10 w-full max-w-lg rounded-md border bg-background px-3"
        value={valida}
        onChange={(e) => setLoja(e.target.value)}
        disabled={acesso.isLoading}
      >
        <option value="">Selecione a loja</option>
        {acesso.lista.map((l) => (
          <option key={l.id} value={l.id}>
            {l.nome}
          </option>
        ))}
      </select>
      {acesso.error && (
        <p role="alert" className="text-destructive">
          {acesso.error.message}
        </p>
      )}
      {valida && client && user && (
        <RegrasLoja
          key={valida}
          loja={valida}
          editar={canManage && permissoes.pode("configuracao_rotinas_editar")}
        />
      )}
      {valida && canManage && permissoes.pode("configuracao_rotinas_editar") && (
        <VendedoresIntermediacao key={`vendedores-${valida}`} loja={valida} />
      )}
      {valida && canManage && permissoes.pode("configuracao_rotinas_editar") && (
        <ProvedorFiscalLoja key={`provedor-fiscal-${valida}`} loja={valida} />
      )}
      {valida && canManage && permissoes.pode("configuracao_rotinas_editar") && (
        <FiscalLoja
          key={`fiscal-${valida}`}
          loja={valida}
          editar={permissoes.pode("configuracao_rotinas_editar")}
        />
      )}
      {valida && (
        <CatalogoLoja
          key={valida}
          loja={valida}
          nome={acesso.lista.find((l) => l.id === valida)?.nome ?? ""}
        />
      )}
      {valida && (
        <FreteVolumeLoja
          key={`frete-${valida}`}
          loja={valida}
          cidadeInicial={valida === lojaInicial ? cidadeInicial : ""}
        />
      )}
      {valida && (
        <div className="rounded-xl border p-4 space-y-3">
          <h3 className="font-semibold">Promoções e descontos por peso</h3>
          <p className="text-sm text-muted-foreground">
            Gerencie campanhas e faixas próprias da loja selecionada.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              to="/tabelas-preco"
              onClick={() => setCentro(valida)}
              className="font-medium underline"
            >
              Configurar promoções desta loja
            </Link>
            <Link
              to="/descontos-peso"
              onClick={() => setCentro(valida)}
              className="font-medium underline"
            >
              Configurar faixas de desconto desta loja
            </Link>
          </div>
        </div>
      )}
      {valida && <CobrancaCentros lojaId={valida} />}
    </section>
  );
}
function RegrasLoja({ loja, editar }: { loja: string; editar: boolean }) {
  const { client, user } = useSupabase();
  const qc = useQueryClient();
  const [valores, setValores] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ["loja-parametros", user?.id, loja],
    queryFn: async () => {
      const { data, error } = await client!.rpc("listar_parametros_loja_243", { _loja: loja });
      if (error) throw new Error(error.message);
      return (data ?? []) as Parametro[];
    },
  });
  useEffect(() => {
    if (q.data)
      setValores(
        Object.fromEntries(
          q.data.filter((p) => campos[p.chave]).map((p) => [p.chave, p.valor ?? ""]),
        ),
      );
  }, [q.data]);
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("salvar_parametros_loja_243", {
        _loja: loja,
        _valores: valores,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Regras desta loja salvas.");
      void qc.invalidateQueries({ queryKey: ["loja-parametros"] });
      void qc.invalidateQueries({ queryKey: ["intermediacao-ativa"] });
      void qc.invalidateQueries({ queryKey: ["validar_pedido"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isPending) return <p>Carregando regras da loja…</p>;
  if (q.error)
    return (
      <p role="alert" className="text-destructive">
        {q.error.message}. Confira a aplicação da fase243 no Supabase.
      </p>
    );
  return (
    <div className="space-y-4">
      <h3 className="font-medium">Regras comerciais e financeiras</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {q.data
          .filter((p) => campos[p.chave])
          .map((p) => {
            const c = campos[p.chave]!;
            const id = `loja-parametro-${p.chave}`;
            const props = {
              id,
              value: valores[p.chave] ?? "",
              disabled: !editar || salvar.isPending,
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
                setValores((v) => ({ ...v, [p.chave]: e.target.value })),
            };
            return (
              <div key={p.chave} className="space-y-2">
                <Label htmlFor={id}>{c.label}</Label>
                {c.tipo === "number" ? (
                  <Input
                    {...props}
                    type="number"
                    min="0"
                    step={p.chave.includes("dias") ? "1" : "0.01"}
                  />
                ) : (
                  <select {...props} className="h-10 w-full rounded-md border bg-background px-3">
                    {c.tipo === "boolean" ? (
                      <>
                        <option value="true">Sim</option>
                        <option value="false">Não</option>
                      </>
                    ) : (
                      <>
                        <option value="venda">Venda</option>
                        <option value="recebimento">Recebimento integral</option>
                      </>
                    )}
                  </select>
                )}
              </div>
            );
          })}
      </div>
      <p className="text-xs text-muted-foreground">
        As regras valem nas próximas validações e apurações. Comissões pagas são preservadas. Os
        prazos das parcelas seguem a forma de pagamento do pedido. Produtos, preços, campanhas e
        faixas de desconto são configurados individualmente por loja.
      </p>
      {!editar && (
        <p className="text-sm text-muted-foreground">
          Sua permissão permite consultar estas regras. A edição exige a autorização de configurar
          regras comerciais da loja.
        </p>
      )}
      <Button
        disabled={!editar || salvar.isPending || !Object.keys(valores).length}
        onClick={() => salvar.mutate()}
      >
        {salvar.isPending ? "Salvando…" : "Salvar regras desta loja"}
      </Button>
      <p className="text-xs text-muted-foreground">
        A cotação da fábrica, o frete e a margem são definidos no orçamento ou pedido, na modalidade
        Intermediação.
      </p>
    </div>
  );
}

function VendedoresIntermediacao({ loja }: { loja: string }) {
  const { client, user } = useSupabase(),
    qc = useQueryClient();
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ["intermediacao-vendedores-config", user?.id, loja],
    queryFn: async () => {
      const [reps, grants] = await Promise.all([
        client!.from("representantes").select("id,nome,profile_id").eq("ativo", true).order("nome"),
        client!
          .from("intermediacao_vendedores_298")
          .select("representante_id")
          .eq("centro_id", loja),
      ]);
      if (reps.error || grants.error) throw Error((reps.error ?? grants.error)!.message);
      return { reps: reps.data, ids: grants.data.map((g) => String(g.representante_id)) };
    },
  });
  useEffect(() => {
    if (q.data) setSelecionados(q.data.ids);
  }, [q.data]);
  const salvar = useMutation({
    mutationFn: async () => {
      const r = await client!.rpc("salvar_vendedores_intermediacao_298", {
        _loja: loja,
        _representantes: selecionados,
      });
      if (r.error) throw Error(r.error.message);
    },
    onSuccess: () => {
      toast.success("Vendedores autorizados nesta loja.");
      void qc.invalidateQueries({ queryKey: ["intermediacao-vendedores-config"] });
      void qc.invalidateQueries({ queryKey: ["intermediacao-vendedor"] });
      void qc.invalidateQueries({ queryKey: ["intermediacao-ativa"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="rounded-xl border p-4 space-y-3">
      <h3 className="font-semibold">Vendedores autorizados • Intermediação</h3>
      <p className="text-sm text-muted-foreground">
        Selecione quem pode usar esta modalidade nesta loja. Administradores e gestores mantêm
        acesso. A autorização não amplia lojas nem carteiras. A intermediação dispensa as margens
        mínimas configuradas para venda de estoque.
      </p>
      {q.isPending && <p>Carregando vendedores…</p>}
      {q.error && (
        <p role="alert" className="text-destructive">
          {q.error.message}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {q.data?.reps.map((r) => (
          <label key={String(r.id)} className="flex items-center gap-2 rounded-md border p-3">
            <input
              type="checkbox"
              checked={selecionados.includes(String(r.id))}
              disabled={salvar.isPending}
              onChange={(e) =>
                setSelecionados((s) =>
                  e.target.checked ? [...s, String(r.id)] : s.filter((id) => id !== String(r.id)),
                )
              }
            />
            <span>
              {String(r.nome)}
              {!r.profile_id && (
                <small className="block text-muted-foreground">
                  O acesso depende de vincular o usuário ao representante.
                </small>
              )}
            </span>
          </label>
        ))}
      </div>
      <Button disabled={!q.data || salvar.isPending} onClick={() => salvar.mutate()}>
        Salvar vendedores autorizados
      </Button>
    </section>
  );
}
