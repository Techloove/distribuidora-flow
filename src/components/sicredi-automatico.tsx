import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/lib/supabase-provider";
import { useCentro } from "@/lib/centro-store";
export function SicrediAutomatico() {
  const { client, user, roles } = useSupabase();
  const { centro } = useCentro();
  const qc = useQueryClient();
  const ultima = useRef<{ escopo: string; alteracao: string | null } | null>(null);
  const permitido = roles.some((r) => ["admin", "gestor", "financeiro"].includes(r));
  useQuery({
    queryKey: ["sicredi-automatico-solicitar", user?.id, centro],
    enabled: !!client && !!user && permitido,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const { data, error } = await client!.rpc("sicredi_auto_solicitar_345", {
        _centro: centro || null,
      });
      if (error)
        throw new Error(
          "Não foi possível solicitar a consulta. O agendamento continua independente.",
        );
      return !!data;
    },
  });
  const q = useQuery({
    queryKey: ["sicredi-automatico", user?.id, centro],
    enabled: !!client && !!user && permitido,
    refetchInterval: 60_000,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await client!.rpc("sicredi_auto_status_247", {
        _centro: centro || null,
      });
      if (error)
        throw new Error("Acompanhamento automático indisponível. Confira a ativação da rotina.");
      return data as {
        ativo: boolean;
        ultima_chamada: string | null;
        pendencias: number;
        ultima_verificacao: string | null;
        ultima_alteracao: string | null;
      } | null;
    },
  });
  useEffect(() => {
    if (!q.data) return;
    const escopo = `${user?.id}:${centro ?? "todos"}`;
    const alteracao = q.data.ultima_alteracao;
    const anterior = ultima.current;
    ultima.current = { escopo, alteracao };
    // A primeira leitura já acompanha a carga inicial da lista; só recarrega após mudança financeira.
    if (anterior?.escopo === escopo && alteracao && anterior.alteracao !== alteracao) {
      void qc.invalidateQueries({ queryKey: ["boletos"] });
      void qc.invalidateQueries({ queryKey: ["contas_receber"] });
      void qc.invalidateQueries({ queryKey: ["vw_boletos_pendentes"] });
    }
  }, [q.data, qc, user?.id, centro]);
  if (!permitido) return null;
  const atrasado =
    q.data?.ultima_chamada && Date.now() - Date.parse(q.data.ultima_chamada) > 15 * 60_000;
  return (
    <section
      className="rounded-xl border bg-card p-4 space-y-2"
      aria-label="Consulta automática Sicredi"
    >
      <h2 className="font-semibold">Consulta automática Sicredi</h2>
      {q.isPending ? (
        <p>Conferindo agendamento…</p>
      ) : q.error ? (
        <p role="alert" className="text-destructive">
          {q.error.message}
        </p>
      ) : (
        <>
          <p className="text-sm">
            {!q.data?.ativo
              ? "Rotina desativada."
              : !q.data.ultima_chamada
                ? "Agendamento preparado, aguardando a primeira chamada do servidor."
                : atrasado
                  ? "Última chamada atrasada: confira o agendamento e a publicação do sistema."
                  : "Rotina ativa: lotes a cada cinco minutos, com prioridade para vencidos e vencimentos nos próximos sete dias, mesmo com o sistema fechado."}
          </p>
          {q.data?.ultima_chamada && (
            <p className="text-xs text-muted-foreground">
              Última chamada do servidor:{" "}
              {new Date(q.data.ultima_chamada).toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              })}
              .
            </p>
          )}
          {!!q.data?.pendencias && (
            <p role="alert" className="text-sm text-destructive">
              {q.data.pendencias} boleto(s) no filtro exigem conferência da consulta ou dos valores.
              Utilize a consulta individual para verificar o motivo; nenhuma baixa é forçada.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Ao abrir esta tela, o sistema verifica a necessidade de um novo lote, sem repetir
            consultas recentes. Boletos próximos são reconsultados após 15 minutos; os mais
            distantes, após seis horas. A lista acompanha os resultados automaticamente. A baixa
            depende da liquidação informada pela API do banco. O prazo inclui o processamento
            bancário e a fila de consultas. Pagamentos incompletos ou divergentes ficam para
            conferência.
          </p>
        </>
      )}
    </section>
  );
}
