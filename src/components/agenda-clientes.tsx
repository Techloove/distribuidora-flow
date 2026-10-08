import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSupabase } from "@/lib/supabase-provider";
import { useCentroValido } from "@/lib/centros-acesso";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { brl } from "@/lib/formatacao";
import { prioridadeComercial, type Registro } from "@/lib/rotinas-distribuidora";
import { AvisoRotina } from "@/components/rotinas-distribuidora";
import { useRotinaRpc } from "@/lib/use-rotina-rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function AgendaClientes({ tipo }: { tipo: "comercial" | "cobranca" }) {
  const { client, user, canManage } = useSupabase();
  const cv = useCentroValido();
  const hoje = hojeSaoPaulo();
  const [cliente, setCliente] = useState<Registro | null>(null);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [resultado, setResultado] = useState(
    tipo === "comercial" ? "Contato realizado" : "Cobrança realizada",
  );
  const [obs, setObs] = useState("");
  const [data, setData] = useState(hoje);
  const [promessa, setPromessa] = useState("");
  const [valor, setValor] = useState("");
  const [status, setStatus] = useState("aberto");
  const rpc = useRotinaRpc(["acompanhamentos"]);
  const fonte = tipo === "comercial" ? "vw_carteira_comercial_209" : "vw_cobranca_clientes_209";
  const q = useQuery({
    queryKey: [fonte, user?.id, cv.centro, busca, pagina],
    enabled: !!client && !cv.isLoading && !cv.error,
    queryFn: async () => {
      let r = client!.from(fonte).select("*", { count: "exact" });
      if (cv.centro)
        r =
          tipo === "comercial"
            ? r.or(`centro_id.eq.${cv.centro},centro_id.is.null`)
            : r.eq("centro_id", cv.centro);
      if (busca.trim()) r = r.ilike("razao_social", `%${busca.trim().replace(/[%,_]/g, "")}%`);
      const { data, error, count } = await (
        tipo === "comercial"
          ? r.order("ultima_compra", { ascending: true, nullsFirst: true })
          : r.order("vencido", { ascending: false })
      )
        .order("cliente_id")
        .range(pagina * 50, pagina * 50 + 49);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as Registro[], count: count ?? 0 };
    },
  });
  const atividades = useQuery({
    queryKey: ["acompanhamentos", user?.id, tipo, cv.centro, cliente?.["cliente_id"], status],
    enabled: !!client && !cv.isLoading && !cv.error,
    queryFn: async () => {
      let r = client!
        .from("acompanhamentos")
        .select("*,clientes(razao_social)", { count: "exact" })
        .eq("tipo", tipo)
        .eq("status", status);
      if (cliente) r = r.eq("cliente_id", cliente["cliente_id"]);
      if (cv.centro) r = r.or(`centro_id.eq.${cv.centro},centro_id.is.null`);
      const { data, error, count } = await r.order("proxima_acao").limit(100);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as unknown as Registro[], count };
    },
  });
  const parcelas = useQuery({
    queryKey: ["cobranca-parcelas", user?.id, cliente?.["cliente_id"], cv.centro],
    enabled: !!client && !!cliente && tipo === "cobranca",
    queryFn: async () => {
      let r = client!
        .from("contas_receber")
        .select("id,documento,parcela,vencimento,valor,valor_pago,status", { count: "exact" })
        .eq("cliente_id", cliente!["cliente_id"])
        .in("status", ["aberto", "parcial"]);
      if (cv.centro) r = r.eq("centro_id", cv.centro);
      const { data, error, count } = await r.order("vencimento").limit(100);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as Registro[], count };
    },
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded border bg-card p-4 space-y-3">
        <h2 className="font-semibold">
          {tipo === "comercial" ? "Prioridades da carteira" : "Clientes com saldo em aberto"}
        </h2>
        <p className="text-xs text-muted-foreground">
          {tipo === "comercial"
            ? "Prioriza clientes sem compras e há mais tempo sem comprar. Valores somam vendas dos centros permitidos. Consulte Lead Rota para oportunidades por produto."
            : "Saldo calculado no banco por cliente e centro. Cobranças abertas têm responsável único por cliente."}
        </p>
        <Input
          aria-label="Buscar cliente na agenda"
          placeholder="Buscar cliente"
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPagina(0);
          }}
        />
        <AvisoRotina erro={q.error} />
        {q.isPending ? (
          <p>Carregando clientes…</p>
        ) : (
          q.data?.rows.map((r) => (
            <button
              key={`${r["cliente_id"]}-${r["centro_id"]}`}
              type="button"
              onClick={() => setCliente(r)}
              className={`w-full rounded border p-3 text-left text-sm ${cliente?.["cliente_id"] === r["cliente_id"] ? "border-primary bg-accent" : ""}`}
            >
              <strong>{String(r["razao_social"])}</strong>
              {tipo === "comercial" ? (
                <>
                  <p>
                    {prioridadeComercial(r, hoje)} · última compra{" "}
                    {String(r["ultima_compra"] ?? "Nunca")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Últimos 30 dias: {brl(r["vendas_30"])} · 30 dias anteriores:{" "}
                    {brl(r["vendas_anteriores_30"])}
                  </p>
                </>
              ) : (
                <p>
                  Aberto {brl(r["aberto"])} · vencido {brl(r["vencido"])}
                </p>
              )}
            </button>
          ))
        )}
        {!q.isPending && !q.error && !q.data?.rows.length && (
          <p className="text-sm">Nenhum cliente neste filtro.</p>
        )}
        <div className="flex gap-2 items-center">
          <Button
            variant="outline"
            disabled={pagina === 0 || q.isFetching}
            onClick={() => setPagina((p) => p - 1)}
          >
            Anterior
          </Button>
          <span className="text-xs">
            Página {pagina + 1} · {q.data?.count ?? "…"} registros
          </span>
          <Button
            variant="outline"
            disabled={q.isFetching || (pagina + 1) * 50 >= (q.data?.count ?? 0)}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </section>
      <div className="space-y-4">
        {cliente && (
          <section className="rounded border bg-card p-4 space-y-3">
            <div className="flex justify-between gap-2">
              <h2 className="font-semibold">{String(cliente["razao_social"])}</h2>
              <Button variant="ghost" size="sm" onClick={() => setCliente(null)}>
                Todos na agenda
              </Button>
            </div>
            <label className="block text-sm">
              Resultado
              <Input
                value={resultado}
                maxLength={100}
                onChange={(e) => setResultado(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Observação / visita
              <Textarea value={obs} maxLength={4000} onChange={(e) => setObs(e.target.value)} />
            </label>
            <label className="block text-sm">
              Próxima ação
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </label>
            {tipo === "cobranca" && (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">
                  Promessa de pagamento
                  <Input
                    type="date"
                    value={promessa}
                    onChange={(e) => setPromessa(e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Valor prometido
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                  />
                </label>
              </div>
            )}
            <Button
              disabled={
                rpc.isPending ||
                !resultado.trim() ||
                !data ||
                (valor !== "" &&
                  (!promessa || !Number.isFinite(Number(valor)) || Number(valor) <= 0))
              }
              onClick={() =>
                rpc.mutate(
                  {
                    nome: "registrar_acompanhamento",
                    args: {
                      _cliente_id: cliente["cliente_id"],
                      _centro_id: cv.centro || cliente["centro_id"] || null,
                      _tipo: tipo,
                      _proxima_acao: data,
                      _resultado: resultado,
                      _observacao: obs,
                      _promessa_data: promessa || null,
                      _promessa_valor: valor === "" ? null : Number(valor),
                    },
                  },
                  {
                    onSuccess: () => {
                      setObs("");
                      setPromessa("");
                      setValor("");
                    },
                  },
                )
              }
            >
              Registrar acompanhamento
            </Button>
            {tipo === "cobranca" && (
              <details>
                <summary className="cursor-pointer text-sm">Parcelas em aberto</summary>
                <AvisoRotina erro={parcelas.error} />
                {parcelas.data?.rows.map((p) => (
                  <p key={String(p["id"])} className="mt-2 text-xs">
                    {String(p["documento"])} / {String(p["parcela"])} · {String(p["vencimento"])} ·
                    saldo {brl(Number(p["valor"]) - Number(p["valor_pago"] ?? 0))}
                  </p>
                ))}
                {(parcelas.data?.count ?? 0) > 100 && (
                  <p className="text-xs">
                    Primeiras 100 de {parcelas.data?.count} parcelas. Veja Contas a receber para a
                    lista completa.
                  </p>
                )}
              </details>
            )}
          </section>
        )}
        <section className="rounded border bg-card p-4 space-y-3">
          <h2 className="font-semibold">Agenda e histórico {cliente ? "do cliente" : ""}</h2>
          <select
            aria-label="Situação do acompanhamento"
            className="rounded border bg-background p-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="aberto">Próximas ações</option>
            <option value="concluido">Histórico concluído</option>
          </select>
          <AvisoRotina erro={atividades.error} />
          {atividades.isPending ? (
            <p>Carregando agenda…</p>
          ) : (
            atividades.data?.rows.map((a) => (
              <article key={String(a["id"])} className="rounded border p-3 text-sm space-y-1">
                <strong>
                  {String((a["clientes"] as Registro | null)?.["razao_social"] ?? "Cliente")}
                </strong>
                <p
                  className={
                    status === "aberto" && String(a["proxima_acao"]) < hoje ? "text-amber-700" : ""
                  }
                >
                  Próxima ação: {String(a["proxima_acao"])} · {String(a["resultado"])}
                </p>
                <p>{String(a["observacao"] ?? "")}</p>
                {a["promessa_data"] != null && (
                  <p>
                    Promessa: {String(a["promessa_data"])} · {brl(a["promessa_valor"])}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Responsável:{" "}
                  {a["responsavel"] === user?.id
                    ? "Você"
                    : String(a["responsavel_nome"] || a["responsavel"])}
                </p>
                {status === "aberto" && (canManage || a["responsavel"] === user?.id) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rpc.isPending}
                    onClick={() =>
                      rpc.mutate({ nome: "concluir_acompanhamento", args: { _id: a["id"] } })
                    }
                  >
                    Concluir ação
                  </Button>
                )}
              </article>
            ))
          )}
          {!atividades.isPending && !atividades.error && !atividades.data?.rows.length && (
            <p className="text-sm text-muted-foreground">Sem acompanhamentos nesta situação.</p>
          )}
          {(atividades.data?.count ?? 0) > 100 && (
            <p className="text-xs">
              Primeiras 100 de {atividades.data?.count} ações. Selecione um cliente para restringir
              a consulta.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
