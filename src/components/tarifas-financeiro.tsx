import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { brl } from "@/lib/formatacao";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { tarifaIdentificada } from "@/lib/sicredi-francesinha";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

type Row = Record<string, unknown>;
const estadosTarifa: Record<string, string> = {
  pausado: "Automação pausada para a loja",
  fora_periodo: "Data anterior ao início autorizado",
  lancado: "Despesa lançada no financeiro e DRE",
  vinculado_manual: "Despesa anterior vinculada, sem duplicação",
  sem_configuracao: "Configure a conta e a categoria da loja",
  configuracao_invalida: "Confira a conta e a categoria configuradas",
  responsavel_sem_acesso: "Responsável sem acesso: revise a configuração",
  conferir_manual: "Confira a tarifa já registrada manualmente",
  conferir_preexistente: "Há uma saída de mesmo valor e data: confira antes de lançar",
  retorno_divergente: "Retorno alterado: lançamento preservado para conferência",
  retorno_ausente: "Retorno ausente: lançamento preservado para conferência",
  estornado: "Despesa estornada: exige conferência",
  movimento_divergente: "Movimento alterado: exige conferência",
  falha_financeira: "Lançamento não concluído: confira o financeiro",
  sem_tarifa: "Sem tarifa identificada",
  pendente: "Aguardando processamento",
};
export function TarifasFinanceiro({ boleto, dados }: { boleto: Row; dados: Row[] }) {
  const { client, user, roles } = useSupabase();
  const permissoes = usePermissoesRotinas();
  const qc = useQueryClient();
  const podeConfigurar =
    permissoes.pode("boletos_tarifa_registrar") &&
    (!roles.includes("representante") || roles.includes("admin"));
  const centro = String(boleto["centro_id"] ?? "");
  const [conta, setConta] = useState<string | null>(null),
    [categoria, setCategoria] = useState<string | null>(null),
    [inicio, setInicio] = useState<string | null>(null),
    [ativo, setAtivo] = useState<boolean | null>(null),
    [confirmado, setConfirmado] = useState(false);
  const config = useQuery({
    queryKey: ["sicredi-tarifa-config", user?.id, centro],
    enabled: !!client && !!centro,
    queryFn: async () => {
      const { data, error } = await client!
        .from("sicredi_tarifas_config_282")
        .select("conta_id,categoria_id,inicio,ativo")
        .eq("centro_id", centro)
        .maybeSingle();
      if (error) throw new Error("Confira o acesso e a instalação da fase282.");
      return data as Row | null;
    },
  });
  const lancamentos = useQuery({
    queryKey: ["sicredi-tarifa-financeiro", user?.id, boleto["id"]],
    enabled: !!client,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await client!
        .from("sicredi_tarifas_financeiro_282")
        .select(
          "data_lancamento,estado,valor_lancado,movimento_id,conta_id,categoria_id,conta:contas_financeiras(nome),categoria:categorias_financeiras(nome),movimento:movimentos_financeiros(status)",
        )
        .eq("boleto_id", String(boleto["id"]))
        .order("data_lancamento");
      if (error) throw new Error("Não foi possível conferir os lançamentos das tarifas.");
      return (data ?? []) as Row[];
    },
  });
  const opcoes = useQuery({
    queryKey: ["sicredi-tarifa-opcoes", user?.id, centro],
    enabled: !!client && !!centro,
    queryFn: async () => {
      const [accounts, cats, titulo] = await Promise.all([
        client!
          .from("contas_financeiras")
          .select("id,nome,centro_id")
          .eq("ativo", true)
          .or(`centro_id.eq.${centro},centro_id.is.null`)
          .order("nome"),
        client!
          .from("categorias_financeiras")
          .select("id,nome,tipo,grupo_dre,parent_id,ativo")
          .order("nome"),
        boleto["conta_receber_id"]
          ? client!
              .from("contas_receber")
              .select("conta_financeira_id")
              .eq("id", String(boleto["conta_receber_id"]))
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (accounts.error || cats.error || titulo.error)
        throw new Error("Não foi possível carregar conta e categoria. Confira suas permissões.");
      const categorias = (cats.data ?? []).filter((c) => {
        const pai = cats.data?.find((p) => p.id === c.parent_id);
        return (
          c.ativo &&
          c.tipo === "despesa" &&
          (pai?.grupo_dre ?? c.grupo_dre) === "despesa_financeira" &&
          (!pai || pai.ativo)
        );
      });
      return {
        contas: accounts.data ?? [],
        categorias,
        sugestao: titulo.data?.conta_financeira_id as string | undefined,
      };
    },
  });
  const valorConta =
    conta ??
    String(
      config.data?.["conta_id"] ??
        opcoes.data?.contas.find((c) => c.id === opcoes.data?.sugestao)?.id ??
        "",
    );
  const valorCategoria =
    categoria ??
    String(
      config.data?.["categoria_id"] ??
        opcoes.data?.categorias.find((c) => c.nome === "Tarifas de emissão de boletos")?.id ??
        "",
    );
  const valorInicio =
    inicio ?? String(config.data?.["inicio"] ?? dados[0]?.["data_lancamento"] ?? hojeSaoPaulo());
  const estaAtivo = ativo ?? (config.data ? config.data["ativo"] === true : true);
  const salvar = useMutation({
    mutationFn: async () => {
      if (!client || !confirmado || !valorConta || !valorCategoria || !valorInicio)
        throw new Error("Escolha conta, categoria, data inicial e confirme a autorização.");
      const { error } = await client.rpc("configurar_tarifas_sicredi_282", {
        _centro: centro,
        _conta: valorConta,
        _categoria: valorCategoria,
        _inicio: valorInicio,
        _ativo: estaAtivo,
        _confirmado: confirmado,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setConfirmado(false);
      await Promise.all(
        [
          "sicredi-tarifa-config",
          "sicredi-tarifa-financeiro",
          "sicredi-tarifa-financeiro-lista",
          "sicredi-tarifa-historico",
          "sicredi-tarifa",
          "vw_extrato_conta",
          "vw_conta_saldo",
          "vw_fluxo_caixa",
          "vw_dre_base",
          "vw_dre_mensal",
          "boletos",
        ].map((k) => qc.invalidateQueries({ queryKey: [k] })),
      );
      toast.success("Configuração salva. Confira abaixo o resultado financeiro de cada tarifa.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const erro = config.error ?? lancamentos.error ?? opcoes.error;
  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Tarifas preenchidas pelo retorno do Sicredi</h3>
      {dados.map((d) => {
        const dia = String(d["data_lancamento"]);
        const l = lancamentos.data?.find((x) => x["data_lancamento"] === dia);
        const itens = Array.isArray(d["debitos"]) ? (d["debitos"] as Row[]) : [];
        return (
          <div key={dia} className="space-y-2 rounded-lg border p-3 text-sm">
            <p>
              <strong>
                {Number(d["tarifa_total"]) > 0 ? brl(d["tarifa_total"]) : "Tarifa não identificada"}
              </strong>{" "}
              · Data do débito: {dia.split("-").reverse().join("/")}
            </p>
            {itens
              .filter((x) => tarifaIdentificada(String(x["descricao"])))
              .map((x, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  {String(x["descricao"])} · {brl(x["valor"])}
                </p>
              ))}
            <p>
              {l
                ? (estadosTarifa[
                    (l["movimento"] as Row | null)?.["status"] === "estornado"
                      ? "estornado"
                      : String(l["estado"])
                  ] ?? "Conferir lançamento")
                : "Aguardando configuração ou processamento"}
            </p>
            {l?.["movimento_id"] ? (
              <p className="text-xs">Valor vinculado no financeiro: {brl(l["valor_lancado"])}</p>
            ) : null}
            {l?.["movimento_id"] ? (
              <p className="text-xs">
                Conta:{" "}
                {String((l["conta"] as Row | null)?.["nome"] ?? "Conferir conta do movimento")} ·
                Categoria:{" "}
                {String(
                  (l["categoria"] as Row | null)?.["nome"] ?? "Conferir categoria do movimento",
                )}
              </p>
            ) : null}
            {Number(d["outros_debitos"]) > 0 && (
              <p className="text-xs">
                Outros débitos sem identificação de tarifa permanecem para conferência.
              </p>
            )}
          </div>
        );
      })}
      {lancamentos.data
        ?.filter((l) => !dados.some((d) => d["data_lancamento"] === l["data_lancamento"]))
        .map((l) => (
          <p key={String(l["data_lancamento"])} className="rounded-lg border p-3 text-sm">
            {String(l["data_lancamento"])} · Retorno da API não disponível nesta consulta.{" "}
            {estadosTarifa[
              (l["movimento"] as Row | null)?.["status"] === "estornado"
                ? "estornado"
                : String(l["estado"])
            ] ?? "Conferir histórico financeiro"}{" "}
            · Valor vinculado:{" "}
            {l["valor_lancado"] == null ? "Não lançado" : brl(l["valor_lancado"])}
          </p>
        ))}
      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro.message}
        </p>
      ) : config.isPending || opcoes.isPending || lancamentos.isPending ? (
        <p>Conferindo configuração financeira…</p>
      ) : (
        podeConfigurar && (
          <fieldset className="space-y-3 rounded-lg border p-4" disabled={salvar.isPending}>
            <legend className="px-1 font-semibold text-sm">
              Conta e categoria para as tarifas desta loja
            </legend>
            <p className="text-xs text-muted-foreground">
              Valor, data e descrição vêm da API. Esta configuração vale para a loja do boleto e
              gera despesas em Despesas Financeiras no DRE, na data do débito.
            </p>
            <div className="space-y-1">
              <Label htmlFor="api-tarifa-conta">Conta financeira do Sicredi</Label>
              <select
                id="api-tarifa-conta"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={valorConta}
                onChange={(e) => setConta(e.target.value)}
              >
                <option value="">Selecione a conta</option>
                {opcoes.data?.contas.map((c) => (
                  <option key={String(c.id)} value={String(c.id)}>
                    {String(c.nome)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="api-tarifa-categoria">Categoria em Despesas Financeiras</Label>
              <select
                id="api-tarifa-categoria"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={valorCategoria}
                onChange={(e) => setCategoria(e.target.value)}
              >
                <option value="">Selecione a categoria</option>
                {opcoes.data?.categorias.map((c) => (
                  <option key={String(c.id)} value={String(c.id)}>
                    {String(c.nome)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="api-tarifa-inicio">Contabilizar tarifas a partir de</Label>
              <Input
                id="api-tarifa-inicio"
                type="date"
                max={hojeSaoPaulo()}
                value={valorInicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={estaAtivo}
                onChange={(e) => setAtivo(e.target.checked)}
              />
              Lançar automaticamente as tarifas retornadas pela API
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmado}
                onChange={(e) => setConfirmado(e.target.checked)}
              />
              Conferi os lançamentos anteriores e autorizo contabilizar as tarifas desta loja desde
              a data inicial, incluindo os retornos já recebidos.
            </label>
            <Button
              disabled={
                !confirmado || !valorConta || !valorCategoria || !valorInicio || salvar.isPending
              }
              onClick={() => salvar.mutate()}
            >
              {salvar.isPending
                ? "Processando…"
                : estaAtivo
                  ? "Salvar e contabilizar tarifas da loja"
                  : "Salvar automação pausada"}
            </Button>
          </fieldset>
        )
      )}
    </div>
  );
}
