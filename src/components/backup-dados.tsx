import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSupabase } from "@/lib/supabase-provider";
import { listarBackups, solicitarBackup } from "@/lib/backup.functions";
const estados = {
  pendente: "Aguardando executor",
  executando: "Em execução",
  sucesso: "Cópia externa verificada",
  falha: "Falhou — revisar infraestrutura",
};
export function BackupDados() {
  const { session } = useSupabase(),
    qc = useQueryClient(),
    listar = useServerFn(listarBackups),
    solicitar = useServerFn(solicitarBackup);
  const chave = ["backups-admin", session?.user.id];
  const q = useQuery({
    queryKey: chave,
    enabled: !!session,
    retry: false,
    refetchInterval: 30_000,
    queryFn: () => listar({ data: { accessToken: session!.access_token } }),
  });
  const m = useMutation({
    mutationFn: () => solicitar({ data: { accessToken: session!.access_token } }),
    onSuccess: () => {
      toast.success("Solicitação registrada. Aguarde o executor concluir a cópia.");
      qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const ativo = q.data?.some((b) => b.estado === "pendente" || b.estado === "executando");
  const data = (v: string) =>
    new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return (
    <section className="mt-6 space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Backup dos dados</h2>
      <p className="text-sm text-muted-foreground">
        Cópia completa de todas as lojas, permissões, carteiras, estoque compartilhado, histórico
        fiscal e arquivos privados. O backup é criptografado e restrito à administração.
      </p>
      <p className="text-sm text-muted-foreground">
        A execução manual e a rotina diária dependem do executor e do armazenamento externo
        configurados. Uma solicitação aguardando executor ainda não é um backup concluído.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => m.mutate()} disabled={m.isPending || ativo || !q.data}>
          {m.isPending
            ? "Solicitando..."
            : ativo
              ? "Backup em andamento ou na fila"
              : "Fazer backup agora"}
        </Button>
        <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>
          Atualizar histórico
        </Button>
      </div>
      {q.error && (
        <p role="alert" className="text-sm text-destructive">
          {q.error.message}
        </p>
      )}
      {q.isPending && !q.error && <p className="text-sm">Carregando histórico...</p>}
      {q.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum backup registrado. O agendamento diário precisa ser ativado no host administrativo.
        </p>
      )}
      {!!q.data?.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">Solicitado (Brasília)</th>
                <th className="p-2">Origem</th>
                <th className="p-2">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="p-2">{data(b.solicitado_em)}</td>
                  <td className="p-2">{b.origem === "manual" ? "Manual" : "Diário"}</td>
                  <td className="p-2">
                    <p>{estados[b.estado]}</p>
                    {b.mensagem && <p className="text-xs text-muted-foreground">{b.mensagem}</p>}
                    {b.finalizado_em && (
                      <p className="text-xs">Finalizado: {data(b.finalizado_em)}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        A recuperação deve ser testada em ambiente separado pelo responsável técnico. Os arquivos
        completos não são disponibilizados no navegador.
      </p>
    </section>
  );
}
