import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/lib/supabase-provider";
import { useCentro } from "@/lib/centro-store";
export function SicrediAutomatico() {
  const { client, user, roles } = useSupabase();
  const { centro } = useCentro();
  const permitido = roles.some((r) => ["admin", "gestor", "financeiro"].includes(r));
  const q = useQuery({
    queryKey: ["sicredi-automatico", user?.id, centro],
    enabled: !!client && !!user && permitido,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await client!.rpc("sicredi_auto_status_247", {
        _centro: centro || null,
      });
      if (error)
        throw new Error("Acompanhamento automático indisponível. Confira a ativação da rotina.");
      return data as { ativo: boolean; ultima_chamada: string | null; pendencias: number } | null;
    },
  });
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
                  : "Rotina ativa: consultas em lotes a cada cinco minutos, mesmo com o sistema fechado."}
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
            A baixa depende da liquidação informada pela API do banco. O prazo inclui o
            processamento bancário e a fila de consultas. Pagamentos incompletos ou divergentes
            ficam para conferência.
          </p>
        </>
      )}
    </section>
  );
}
