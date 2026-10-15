import { AcoesLeadCliente } from "@/components/lead-rota-agenda";
import {
  FILTROS_AGENDA,
  dataAgenda,
  resultadoAgenda,
  type AgendaFiltros,
} from "@/lib/agenda-comercial";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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

export function AgendaClientes({
  tipo,
  reativacao = false,
  filtros = FILTROS_AGENDA,
  clienteInicialId,
}: {
  tipo: "comercial" | "cobranca";
  reativacao?: boolean;
  filtros?: AgendaFiltros;
  clienteInicialId?: string | null;
}) {
  const permissoes = usePermissoesRotinas();
  const podeAcompanhar = permissoes.pode(
    reativacao
      ? "clientes_reativar"
      : tipo === "comercial"
        ? "comercial_acompanhar"
        : "cobranca_acompanhar",
  );
  const { client, user, canManage, roles } = useSupabase();
  const escopo = roles.slice().sort().join(",");
  const cv = useCentroValido();
  const hoje = hojeSaoPaulo();
  const [cliente, setCliente] = useState<Registro | null>(null);
  const [pagina, setPagina] = useState(0);
  const [resultado, setResultado] = useState(
    tipo === "comercial" ? "Contato realizado" : "Cobrança realizada",
  );
  const [obs, setObs] = useState("");
  const [data, setData] = useState(hoje);
  const [promessa, setPromessa] = useState("");
  const [valor, setValor] = useState("");
  const [status, setStatus] = useState("aberto");
  const rpc = useRotinaRpc([
    "acompanhamentos",
    "agenda_clientes_228",
    "agenda_leads_229",
    "lead_contatos",
    "agenda_lead_cliente_229",
  ]);
  const [paginaTitulos, setPaginaTitulos] = useState(0);
  const [paginaAtividades, setPaginaAtividades] = useState(0);
  const q = useQuery({
    queryKey: [
      "agenda_clientes_228",
      user?.id,
      escopo,
      cv.centro,
      tipo,
      reativacao,
      filtros,
      pagina,
    ],
    enabled: !!client && podeAcompanhar && !cv.isLoading && !cv.error,
    queryFn: async () => {
      const { data, error } = await client!.rpc("agenda_clientes_228", {
        _aba: reativacao ? "reativacao" : tipo,
        _centro: cv.centro || null,
        _representante: filtros.representante || null,
        _rota: filtros.rota || null,
        _busca: filtros.busca.trim(),
        _dias: filtros.dias,
        _pagina: pagina,
        _cidade: filtros.cidade,
      });
      if (error)
        throw new Error(
          /schema cache|does not exist|Could not find/.test(error.message)
            ? "Aplique a fase228 no Supabase para utilizar a agenda unificada."
            : error.message,
        );
      return data as { rows: Registro[]; count: number; resumo: Registro };
    },
  });
  const selecaoInicialAplicada = useRef<string | null>(null);
  useEffect(() => {
    if (clienteInicialId && selecaoInicialAplicada.current !== clienteInicialId && !cliente) {
      const selecionado = q.data?.rows.find((r) => r["cliente_id"] === clienteInicialId);
      if (selecionado) {
        selecaoInicialAplicada.current = clienteInicialId;
        setCliente(selecionado);
      }
    }
  }, [clienteInicialId, cliente, q.data]);
  const atividades = useQuery({
    queryKey: [
      "acompanhamentos",
      user?.id,
      escopo,
      tipo,
      cv.centro,
      cliente?.["cliente_id"],
      status,
      filtros,
      paginaAtividades,
    ],
    enabled: !!client && podeAcompanhar && !cv.isLoading && !cv.error,
    queryFn: async () => {
      let r = client!
        .from("acompanhamentos")
        .select("*,clientes!inner(razao_social,representante_id,rota_id,cidade)", {
          count: "exact",
        })
        .eq("tipo", tipo)
        .eq("status", status);
      if (cliente) r = r.eq("cliente_id", cliente["cliente_id"]);
      if (filtros.representante) r = r.eq("clientes.representante_id", filtros.representante);
      if (filtros.rota) r = r.eq("clientes.rota_id", filtros.rota);
      if (filtros.cidade) r = r.eq("clientes.cidade", filtros.cidade);
      if (!cliente && filtros.busca.trim())
        r = r.ilike("clientes.razao_social", `%${filtros.busca.trim().replace(/[%,_]/g, "")}%`);
      if (cv.centro) r = r.or(`centro_id.eq.${cv.centro},centro_id.is.null`);
      const { data, error, count } = await r
        .order("proxima_acao")
        .order("id")
        .range(paginaAtividades * 50, paginaAtividades * 50 + 49);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as unknown as Registro[], count };
    },
  });
  const parcelas = useQuery({
    queryKey: [
      "cobranca-parcelas",
      user?.id,
      escopo,
      cliente?.["cliente_id"],
      cv.centro,
      paginaTitulos,
    ],
    enabled: !!client && podeAcompanhar && !!cliente && tipo === "cobranca",
    queryFn: async () => {
      const { data, error } = await client!.rpc("agenda_titulos_228", {
        _cliente: cliente!["cliente_id"],
        _centro: cv.centro || null,
        _pagina: paginaTitulos,
      });
      if (error) throw new Error(error.message);
      return data as { rows: Registro[]; count: number };
    },
  });
  if (!podeAcompanhar)
    return (
      <p role="status" className="rounded border p-4 text-sm">
        {permissoes.carregando
          ? "Verificando acesso…"
          : "Seu perfil não tem permissão para acompanhar esta agenda."}
      </p>
    );
  return (
    <div className="space-y-4">
      {cv.error && (
        <p role="alert" className="text-destructive">
          {cv.error.message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Clientes no filtro</p>
          <p className="mt-1 text-2xl font-semibold">{q.data?.count ?? "…"}</p>
        </div>
        {tipo === "cobranca" ? (
          <>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">Saldo em aberto</p>
              <p className="mt-1 text-2xl font-semibold">
                {q.data ? brl(q.data.resumo["aberto"]) : "…"}
              </p>
            </div>
            <div className="col-span-2 rounded-xl border bg-card p-4 sm:col-span-1">
              <p className="text-xs text-muted-foreground">Vencido</p>
              <p className="mt-1 text-2xl font-semibold text-amber-700">
                {q.data ? brl(q.data.resumo["vencido"]) : "…"}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">
                Sem comprar há {filtros.dias} dias ou mais
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {(q.data?.resumo["sem_comprar"] as number) ?? "…"}
              </p>
            </div>
            <div className="col-span-2 rounded-xl border bg-card p-4 sm:col-span-1">
              <p className="text-xs text-muted-foreground">Soma dos tickets médios · estimativa</p>
              <p className="mt-1 text-2xl font-semibold">
                {q.data ? brl(q.data.resumo["potencial"]) : "…"}
              </p>
            </div>
          </>
        )}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="rounded border bg-card p-4 space-y-3">
          <h2 className="font-semibold">
            {reativacao
              ? "Clientes para reativar"
              : tipo === "comercial"
                ? "Prioridades da carteira"
                : "Clientes com saldo em aberto"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {tipo === "comercial"
              ? "Prioriza clientes sem compras e há mais tempo sem comprar. Valores somam vendas dos centros permitidos. Consulte Lead Rota para oportunidades por produto."
              : "Valores incluem os encargos e descontos registrados, respeitando o centro selecionado. Cobrar não realiza baixa financeira."}
          </p>
          <AvisoRotina erro={q.error} />
          <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1 print:max-h-none print:overflow-visible">
            {q.isPending ? (
              <p>Carregando clientes…</p>
            ) : (
              q.data?.rows.map((r) => (
                <button
                  key={`${r["cliente_id"]}-${r["centro_id"]}`}
                  type="button"
                  aria-pressed={cliente?.["cliente_id"] === r["cliente_id"]}
                  onClick={() => {
                    setCliente(r);
                    setObs("");
                    setPromessa("");
                    setValor("");
                    setData(hoje);
                    setPaginaTitulos(0);
                    setPaginaAtividades(0);
                    setResultado(tipo === "comercial" ? "Contato realizado" : "Cobrança realizada");
                  }}
                  className={`w-full rounded border p-3 text-left text-sm ${cliente?.["cliente_id"] === r["cliente_id"] ? "border-primary bg-accent" : ""}`}
                >
                  <strong>
                    {String(r["codigo"] ?? "")} · {String(r["razao_social"])}
                  </strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[r["representante"], r["rota"], r["cidade"]].filter(Boolean).join(" · ")}
                  </p>
                  {tipo === "comercial" ? (
                    <>
                      <p>
                        {prioridadeComercial(r, hoje)} · última compra{" "}
                        {r["ultima_compra"] ? dataAgenda(r["ultima_compra"]) : "Nunca"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {reativacao ? (
                          <>
                            {r["ultima_compra"]
                              ? `${r["dias_sem_comprar"]} dias sem comprar`
                              : "Sem compras registradas"}{" "}
                            · Ticket médio: {brl(r["ticket_medio"])}
                          </>
                        ) : (
                          <>
                            Últimos 30 dias: {brl(r["vendas_30"])} · 30 dias anteriores:{" "}
                            {brl(r["vendas_anteriores_30"])}
                          </>
                        )}
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
          </div>
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
          {!cliente && (
            <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              Selecione um cliente para registrar uma visita, contato ou cobrança e consultar seu
              histórico.
            </div>
          )}
          {cliente && (
            <section className="rounded border bg-card p-4 space-y-3">
              <div className="flex justify-between gap-2">
                <h2 className="font-semibold">{String(cliente["razao_social"])}</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCliente(null);
                    setPaginaAtividades(0);
                  }}
                >
                  Todos na agenda
                </Button>
              </div>
              <AcoesLeadCliente
                key={String(cliente["cliente_id"])}
                clienteId={String(cliente["cliente_id"])}
              />
              {cliente["telefone"] != null && (
                <p className="text-sm text-muted-foreground">
                  Telefone: {String(cliente["telefone"])}
                </p>
              )}
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
                        _centro_id:
                          cv.centro || (tipo === "cobranca" ? null : cliente["centro_id"]) || null,
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
                      {String(p["documento"])} / {String(p["parcela"])} ·{" "}
                      {dataAgenda(p["vencimento"])} · saldo {brl(p["saldo"])}
                    </p>
                  ))}
                  {parcelas.isPending && <p className="text-xs">Carregando parcelas…</p>}
                  {!parcelas.isPending && !parcelas.error && !parcelas.data?.rows.length && (
                    <p className="text-xs">Sem parcelas em aberto neste filtro.</p>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={paginaTitulos === 0 || parcelas.isFetching}
                      onClick={() => setPaginaTitulos((n) => n - 1)}
                    >
                      Anteriores
                    </Button>
                    <span className="text-xs">
                      Página {paginaTitulos + 1} · {parcelas.data?.count ?? 0} parcelas
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        parcelas.isFetching ||
                        (paginaTitulos + 1) * 50 >= (parcelas.data?.count ?? 0)
                      }
                      onClick={() => setPaginaTitulos((n) => n + 1)}
                    >
                      Próximas
                    </Button>
                  </div>
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
              onChange={(e) => {
                setStatus(e.target.value);
                setPaginaAtividades(0);
              }}
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
                      status === "aberto" && String(a["proxima_acao"]) < hoje
                        ? "text-amber-700"
                        : ""
                    }
                  >
                    Próxima ação: {dataAgenda(a["proxima_acao"])} ·{" "}
                    {resultadoAgenda(a["resultado"])}
                  </p>
                  <p>{String(a["observacao"] ?? "")}</p>
                  {a["promessa_data"] != null && (
                    <p>
                      Promessa: {dataAgenda(a["promessa_data"])} · {brl(a["promessa_valor"])}
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
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={paginaAtividades === 0 || atividades.isFetching}
                onClick={() => setPaginaAtividades((n) => n - 1)}
              >
                Anteriores
              </Button>
              <span className="text-xs">
                Página {paginaAtividades + 1} · {atividades.data?.count ?? 0} ações
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  atividades.isFetching ||
                  (paginaAtividades + 1) * 50 >= (atividades.data?.count ?? 0)
                }
                onClick={() => setPaginaAtividades((n) => n + 1)}
              >
                Próximas
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
