import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { Button } from "./ui/button";
export function DiagnosticoIntegridade() {
  const { client, user } = useSupabase(),
    perm = usePermissoesRotinas();
  const q = useQuery({
    queryKey: ["diagnostico_integridade", user?.id],
    enabled: !!client && perm.pode("integridade_ver"),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await client!.rpc("diagnostico_integridade_220");
      if (error) throw new Error(error.message);
      return (data ?? []) as { verificacao: string; pendencias: number }[];
    },
  });
  if (!perm.pode("integridade_ver")) return null;
  return (
    <section className="rounded border p-4 space-y-3">
      <h2 className="font-semibold">Diagnóstico de integridade</h2>
      <p className="text-xs text-muted-foreground">
        Consulta atualizada a cada minuto enquanto esta tela estiver aberta. Contagens e recusas
        pendentes podem fazer parte da operação normal; confira cada ocorrência antes de ajustar
        dados.
      </p>
      <Button variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}>
        Atualizar diagnóstico
      </Button>
      {q.isPending && <p>Consultando…</p>}
      {q.error && <p role="alert">{q.error.message}</p>}
      {q.data?.map((r) => (
        <p key={r.verificacao} className="text-sm">
          {r.verificacao}: <strong>{r.pendencias}</strong>
        </p>
      ))}
      {q.dataUpdatedAt > 0 && (
        <p className="text-xs text-muted-foreground">
          Última consulta: {new Date(q.dataUpdatedAt).toLocaleString("pt-BR")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        A consulta não confirma backups nem disponibilidade contínua do serviço. Backup externo e
        teste de restauração exigem configuração da infraestrutura.
      </p>
    </section>
  );
}
