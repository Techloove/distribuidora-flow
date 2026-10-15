import { EntregaPorItem, AbrirComprovante } from "@/components/entrega-por-item";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useRotinaRpc } from "@/lib/use-rotina-rpc";
import { useSupabase } from "@/lib/supabase-provider";
import { useCentroValido } from "@/lib/centros-acesso";
import { brl } from "@/lib/formatacao";
import type { Registro } from "@/lib/rotinas-distribuidora";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function AvisoRotina({ erro }: { erro: Error | null }) {
  return erro ? (
    <p role="alert" className="text-sm text-destructive">
      {erro.message.includes("schema cache") || erro.message.includes("does not exist")
        ? "Esta rotina precisa da migração fase209 no Supabase."
        : erro.message}
    </p>
  ) : null;
}

export function MargemPedido({ pedido }: { pedido: Registro }) {
  const permissoes = usePermissoesRotinas();
  const { client, user, canManage } = useSupabase();
  const [frete, setFrete] = useState("");
  const [tributos, setTributos] = useState(String(pedido["tributos_estimados"] ?? 0));
  const [despesas, setDespesas] = useState(String(pedido["despesas_variaveis"] ?? 0));
  const q = useQuery({
    queryKey: ["vw_margem_pedido_209", user?.id, pedido["id"]],
    enabled: !!client && permissoes.pode("margem_pedido_ver"),
    queryFn: async () => {
      const { data, error } = await client!
        .from("vw_resultado_estimado_215")
        .select("*")
        .eq("pedido_id", pedido["id"])
        .single();
      if (error)
        throw new Error(
          error.message.includes("schema cache") || error.message.includes("does not exist")
            ? "Aplique a fase215 no Supabase para consultar resultado estimado."
            : error.message,
        );
      return data as Registro;
    },
  });
  const itens = useQuery({
    queryKey: ["margem-produtos", user?.id, pedido["id"]],
    enabled: !!client && permissoes.pode("margem_pedido_ver"),
    queryFn: async () => {
      const { data, error } = await client!
        .from("pedido_itens")
        .select(
          "id,quantidade,total,custo_unitario_base,produtos(descricao,custo_medio,preco_custo,ultimo_custo)",
        )
        .eq("pedido_id", pedido["id"]);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Registro[];
    },
  });
  const rpc = useRotinaRpc(["vw_margem_pedido_209", "pedidos"]);
  if (!permissoes.pode("margem_pedido_ver")) return null;
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold">Margem de contribuição do pedido</h2>
      <AvisoRotina erro={q.error} />
      {q.isPending ? (
        <p className="text-sm">Calculando margem…</p>
      ) : q.data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-sm">
            {[
              ["Custo dos produtos", brl(q.data["custo"])],
              ["Comissão prevista", brl(q.data["comissao"])],
              ["Custo do frete", brl(q.data["custo_frete"])],
              ["Contribuição", brl(q.data["resultado"])],
              ["Margem", `${q.data["margem"] ?? "—"}%`],
              ["Resultado estimado antes das despesas fixas", brl(q.data["resultado_estimado"])],
            ].map(([l, v]) => (
              <div key={l}>
                <p className="text-xs text-muted-foreground">{l}</p>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          {Number(q.data["sem_custo"]) > 0 && (
            <p className="text-sm text-amber-700">
              Há produto sem custo informado. O resultado está incompleto e exige aprovação.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Descontos já estão na receita. Frete cobrado é receita; informe o custo efetivo do
            transporte. Contribuição antes de tributos e despesas fixas. A comissão segue o valor
            calculado no pedido. Custo atual até confirmar; pedidos antigos sem captura usam custo
            atual.
          </p>
          {canManage &&
            permissoes.pode("rentabilidade_editar") &&
            ["rascunho", "digitacao", "aguardando_aprovacao", "aprovado"].includes(
              String(pedido["status"]),
            ) && (
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-xs">
                  Tributos estimados (R$)
                  <Input
                    aria-label="Tributos estimados do pedido"
                    type="number"
                    min="0"
                    step="0.01"
                    value={tributos}
                    onChange={(e) => setTributos(e.target.value)}
                  />
                </label>
                <label className="text-xs">
                  Despesas variáveis (R$)
                  <Input
                    aria-label="Despesas variáveis do pedido"
                    type="number"
                    min="0"
                    step="0.01"
                    value={despesas}
                    onChange={(e) => setDespesas(e.target.value)}
                  />
                </label>
                <Button
                  disabled={rpc.isPending || Number(tributos) < 0 || Number(despesas) < 0}
                  onClick={() =>
                    rpc.mutate({
                      nome: "definir_rentabilidade_215",
                      args: {
                        _pedido: pedido["id"],
                        _tributos: Number(tributos),
                        _despesas: Number(despesas),
                      },
                    })
                  }
                >
                  Salvar estimativas
                </Button>
              </div>
            )}
          {canManage &&
            permissoes.pode("frete_pedido_editar") &&
            ["rascunho", "digitacao", "aguardando_aprovacao", "aprovado"].includes(
              String(pedido["status"]),
            ) && (
              <div className="flex flex-wrap gap-2 items-end">
                <label className="text-xs">
                  Custo do transporte (R$)
                  <Input
                    aria-label="Custo do transporte"
                    type="number"
                    min="0"
                    step="0.01"
                    value={frete}
                    placeholder={String(q.data["custo_frete"])}
                    onChange={(e) => setFrete(e.target.value)}
                  />
                </label>
                <Button
                  size="sm"
                  disabled={
                    rpc.isPending ||
                    frete === "" ||
                    !Number.isFinite(Number(frete)) ||
                    Number(frete) < 0
                  }
                  onClick={() =>
                    rpc.mutate({
                      nome: "definir_custo_frete_pedido",
                      args: { _pedido_id: pedido["id"], _valor: Number(frete) },
                    })
                  }
                >
                  Salvar custo
                </Button>
              </div>
            )}
          <details>
            <summary className="cursor-pointer text-xs">Margem por produto</summary>
            <AvisoRotina erro={itens.error} />
            {itens.data?.map((i) => {
              const p = i["produtos"] as Registro | null;
              const custo =
                Number(
                  i["custo_unitario_base"] ??
                    (Number(p?.["custo_medio"]) ||
                      Number(p?.["preco_custo"]) ||
                      Number(p?.["ultimo_custo"]) ||
                      0),
                ) * Number(i["quantidade"]);
              const receita = Number(i["total"]);
              return (
                <p key={String(i["id"])} className="mt-2 text-xs">
                  {String(p?.["descricao"] ?? "Produto")} · contribuição bruta{" "}
                  {brl(receita - custo)} ·{" "}
                  {receita > 0 ? (((receita - custo) / receita) * 100).toFixed(1) : "—"}%{" "}
                  {custo <= 0 ? "(sem custo)" : ""}
                </p>
              );
            })}
          </details>
        </>
      ) : null}
    </section>
  );
}

export function ReposicaoInteligente() {
  const permissoes = usePermissoesRotinas();
  const { client, user } = useSupabase();
  const cv = useCentroValido();
  const [filtro, setFiltro] = useState("repor");
  const q = useQuery({
    queryKey: ["vw_reposicao_209", user?.id, cv.centro, filtro],
    enabled: !!client && permissoes.pode("reposicao_ver") && !cv.isLoading && !cv.error,
    queryFn: async () => {
      let r = client!.from("vw_reposicao_209").select("*", { count: "exact" });
      if (filtro) r = r.eq("situacao", filtro);
      const { data, error, count } = await r
        .order("compra_recomendada", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as Registro[], count };
    },
  });
  if (!permissoes.pode("reposicao_ver")) return null;
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold">Reposição inteligente</h2>
      <label className="text-sm">
        Prioridade{" "}
        <select
          className="rounded border bg-background p-2"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        >
          <option value="repor">Risco de falta</option>
          <option value="parado">Estoque sem vendas em 90 dias</option>
          <option value="">Todos</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        Considera consumo de 90 dias, prazo do fornecedor, mínimo, pedidos pendentes e compras em
        trânsito. Recomendação para prazo + 30 dias; revise antes de comprar.
      </p>
      <AvisoRotina erro={q.error} />
      {q.isPending ? (
        <p>Carregando reposição…</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {q.data?.rows.map((r) => (
            <article
              key={`${r["centro_id"]}-${r["produto_id"]}`}
              className="rounded border p-3 text-sm"
            >
              <strong>{String(r["descricao"])}</strong>
              <p className="text-xs text-muted-foreground">
                {String(r["centro"])} · disponível {String(r["estoque_atual"])} · pendente{" "}
                {String(r["pedidos_pendentes"])} · trânsito {String(r["em_transito"])}
              </p>
              <p>
                Cobertura:{" "}
                {r["cobertura_dias"] == null ? "Sem consumo" : `${r["cobertura_dias"]} dias`} ·
                prazo: {String(r["prazo_fornecedor_dias"] ?? 0)} dias
              </p>
              <p className="font-medium">
                Compra sugerida: {String(r["compra_recomendada"])} {String(r["unidade"] ?? "")}
              </p>
            </article>
          ))}
        </div>
      )}
      {!q.isPending && !q.error && !q.data?.rows.length && (
        <p className="text-sm text-muted-foreground">Nenhum produto nesta prioridade.</p>
      )}
      {(q.data?.count ?? 0) > 100 && (
        <p className="text-xs">Exibindo os primeiros 100 de {q.data?.count} produtos/centros.</p>
      )}
    </section>
  );
}

export function RegistroEntrega({ expedicao }: { expedicao: Registro }) {
  const permissoes = usePermissoesRotinas();
  const { client, user } = useSupabase();
  const [aberto, setAberto] = useState(false);
  const [obs, setObs] = useState("");
  const rpc = useRotinaRpc([
    "entrega_registros",
    "expedicoes",
    "vw_expedicoes",
    "entregas_listar_232",
    "pedidos",
    "cargas",
    "vw_cargas",
  ]);
  const q = useQuery({
    queryKey: ["entrega_registros", user?.id, expedicao["id"]],
    enabled: !!client && permissoes.pode("entrega_registrar") && aberto,
    queryFn: async () => {
      const { data, error } = await client!
        .from("entrega_registros")
        .select("*")
        .eq("expedicao_id", expedicao["id"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as Registro[];
    },
  });
  if (!permissoes.pode("entrega_registrar")) return null;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation();
          setAberto(true);
        }}
      >
        Ocorrências e entregas parciais
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Entrega do pedido #{String(expedicao["pedido_numero"] ?? expedicao["numero"])}
            </DialogTitle>
            <DialogDescription>
              Consulte o histórico, registre ocorrências ou informe entregas parciais e recusas. A
              entrega completa é formalizada na tela Entregas.
            </DialogDescription>
          </DialogHeader>
          <EntregaPorItem expedicao={expedicao} />
          <label className="text-sm">
            Observação
            <Textarea value={obs} maxLength={4000} onChange={(e) => setObs(e.target.value)} />
          </label>
          <Button
            disabled={rpc.isPending || !obs.trim()}
            onClick={() =>
              rpc.mutate(
                {
                  nome: "registrar_entrega",
                  args: {
                    _expedicao_id: expedicao["id"],
                    _tipo: "ocorrencia",
                    _recebedor: null,
                    _comprovante: null,
                    _observacao: obs,
                  },
                },
                {
                  onSuccess: () => {
                    setObs("");
                  },
                },
              )
            }
          >
            Salvar registro
          </Button>
          <AvisoRotina erro={q.error} />
          <div className="space-y-2">
            {q.data?.map((r) => (
              <article className="rounded border p-3 text-xs" key={String(r["id"])}>
                <strong>
                  {String(r["tipo"])} ·{" "}
                  {new Date(String(r["created_at"])).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}
                </strong>
                <p>
                  {String(r["recebedor"] ?? "")} {String(r["observacao"] ?? "")}
                </p>
                <p className="break-words">{String(r["comprovante"] ?? "")}</p>
                {r["arquivo_path"] ? <AbrirComprovante path={String(r["arquivo_path"])} /> : null}
              </article>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CapacidadeCarga({ carga }: { carga: Registro }) {
  const permissoes = usePermissoesRotinas();
  const { client, user } = useSupabase();
  const [valor, setValor] = useState("");
  const rpc = useRotinaRpc(["cargas", "vw_cargas", "capacidade-carga"]);
  const q = useQuery({
    queryKey: ["capacidade-carga", user?.id, carga["id"]],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("cargas")
        .select("capacidade_kg,peso_kg,status")
        .eq("id", carga["id"])
        .single();
      if (error) throw new Error(error.message);
      return data as Registro;
    },
  });
  const peso = Number(q.data?.["peso_kg"] ?? 0),
    cap = Number(q.data?.["capacidade_kg"] ?? 0);
  return (
    <section className="rounded border p-3 space-y-2 text-sm">
      <h2 className="font-semibold">Capacidade do veículo</h2>
      <AvisoRotina erro={q.error} />
      {q.data && (
        <p className={cap > 0 && peso > cap ? "text-destructive" : ""}>
          Peso {peso.toLocaleString("pt-BR")} kg ·{" "}
          {cap > 0
            ? `capacidade ${cap.toLocaleString("pt-BR")} kg · ${((peso / cap) * 100).toFixed(1)}% ocupado`
            : "capacidade ainda não informada"}
        </p>
      )}
      {permissoes.pode("carga_capacidade_editar") &&
        ["aberta", "em_preparacao"].includes(String(q.data?.["status"])) && (
          <div className="flex gap-2">
            <Input
              aria-label="Capacidade do veículo em kg"
              type="number"
              min="0.001"
              value={valor}
              placeholder="Capacidade em kg"
              onChange={(e) => setValor(e.target.value)}
            />
            <Button
              disabled={rpc.isPending || !Number.isFinite(Number(valor)) || Number(valor) <= 0}
              onClick={() =>
                rpc.mutate({
                  nome: "definir_capacidade_carga",
                  args: { _carga_id: carga["id"], _capacidade: Number(valor) },
                })
              }
            >
              Salvar
            </Button>
          </div>
        )}
    </section>
  );
}

export function TrocaDevolucao({ devolucao }: { devolucao: Registro }) {
  const permissoes = usePermissoesRotinas();
  const { client, user, canManage } = useSupabase();
  const [pedido, setPedido] = useState("");
  const rpc = useRotinaRpc(["devolucoes"]);
  const q = useQuery({
    queryKey: ["pedidos-troca", user?.id, devolucao["id"]],
    enabled:
      !!client &&
      permissoes.pode("troca_vincular") &&
      canManage &&
      devolucao["status"] === "confirmada",
    queryFn: async () => {
      const { data, error } = await client!
        .from("pedidos")
        .select("id,numero,total_liquido,status")
        .eq("cliente_id", devolucao["cliente_id"])
        .eq("centro_id", devolucao["centro_id"])
        .neq("id", devolucao["pedido_id"] ?? "00000000-0000-0000-0000-000000000000")
        .not("status", "in", "(cancelado,recusado)")
        .order("numero", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as Registro[];
    },
  });
  if (devolucao["status"] !== "confirmada") return null;
  return (
    <section className="rounded border bg-card p-3 space-y-2 text-sm">
      <h2 className="font-semibold">Troca vinculada ao novo pedido</h2>
      <p className="text-xs text-muted-foreground">
        O crédito da devolução pode ser aplicado no pedido de reposição pela rotina existente de
        créditos. O vínculo sozinho não consome o crédito.
      </p>
      {devolucao["pedido_troca_id"] != null && (
        <p>Pedido vinculado: {String(devolucao["pedido_troca_id"])}</p>
      )}
      <AvisoRotina erro={q.error} />
      {canManage && permissoes.pode("troca_vincular") && (
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Novo pedido da troca"
            className="max-w-full rounded border bg-background p-2"
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
          >
            <option value="">Selecione o novo pedido</option>
            {q.data?.map((p) => (
              <option key={String(p["id"])} value={String(p["id"])}>
                #{String(p["numero"])} · {brl(p["total_liquido"])}
              </option>
            ))}
          </select>
          <Button
            disabled={!pedido || rpc.isPending}
            onClick={() =>
              rpc.mutate({
                nome: "vincular_pedido_troca",
                args: { _devolucao_id: devolucao["id"], _pedido_id: pedido },
              })
            }
          >
            Vincular troca
          </Button>
        </div>
      )}
    </section>
  );
}

export function AjustesComissao() {
  const permissoes = usePermissoesRotinas();
  const { client, user, roles } = useSupabase();
  const cv = useCentroValido();
  const pode =
    permissoes.pode("comissao_ajustes_conferir") &&
    roles.some((r) => ["admin", "gestor", "financeiro"].includes(r));
  const [resolucoes, setResolucoes] = useState<Record<string, string>>({});
  const rpc = useRotinaRpc(["comissao_ajustes"]);
  const regra = useQuery({
    queryKey: ["parametros", "comissao", user?.id],
    enabled: !!client && permissoes.pode("comissao_ajustes_ver"),
    queryFn: async () => {
      const { data, error } = await client!
        .from("parametros")
        .select("valor")
        .eq("chave", "comissao_fato_gerador")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.valor;
    },
  });
  const q = useQuery({
    queryKey: ["comissao_ajustes", user?.id, cv.centro],
    enabled: !!client && permissoes.pode("comissao_ajustes_ver") && !cv.isLoading && !cv.error,
    queryFn: async () => {
      let r = client!
        .from("comissao_ajustes")
        .select("*", { count: "exact" })
        .eq("status", "pendente");
      if (cv.centro) r = r.eq("centro_id", cv.centro);
      const { data, error, count } = await r.order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as Registro[], count };
    },
  });
  if (!permissoes.pode("comissao_ajustes_ver")) return null;
  return (
    <section className="rounded border bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold">Conferência de comissões e devoluções</h2>
      <p className="text-xs text-muted-foreground">
        Regra de liberação:{" "}
        {regra.data === "recebimento" ? "recebimento integral do pedido" : "venda"}. Configurável em
        Configurações → comissao_fato_gerador. Devoluções corrigem comissões ainda não pagas;
        valores já pagos geram ajuste para conferência financeira.
      </p>
      <AvisoRotina erro={q.error} />
      <AvisoRotina erro={regra.error} />
      {q.data?.rows.map((a) => {
        const id = String(a["id"]);
        return (
          <article key={id} className="rounded border p-3 space-y-2 text-sm">
            <p>
              Ajuste de comissão paga: <strong>{brl(a["valor"])}</strong> · pedido{" "}
              {String(a["pedido_id"])}
            </p>
            {pode && (
              <>
                <Input
                  aria-label="Resolução do ajuste"
                  placeholder="Como foi acertado no financeiro? Informe documento ou lançamento."
                  value={resolucoes[id] ?? ""}
                  onChange={(e) => setResolucoes((s) => ({ ...s, [id]: e.target.value }))}
                />
                <Button
                  size="sm"
                  disabled={rpc.isPending || !resolucoes[id]?.trim()}
                  onClick={() =>
                    rpc.mutate({
                      nome: "conferir_ajuste_comissao",
                      args: { _id: id, _resolucao: resolucoes[id] },
                    })
                  }
                >
                  Registrar conferência
                </Button>
              </>
            )}
          </article>
        );
      })}
      {!q.isPending && !q.error && !q.data?.rows.length && (
        <p className="text-sm text-muted-foreground">Sem ajustes pendentes.</p>
      )}
      {(q.data?.count ?? 0) > 100 && <p>Exibindo 100 de {q.data?.count} ajustes.</p>}
    </section>
  );
}
