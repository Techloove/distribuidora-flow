import { Table } from "@/components/ui/table";
import { useState } from "react";
import { salvarBackupNoComputador } from "@/lib/backup-download";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSupabase } from "@/lib/supabase-provider";
import { listarBackups, solicitarBackup, baixarBackup } from "@/lib/backup.functions";
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
    solicitar = useServerFn(solicitarBackup),
    baixar = useServerFn(baixarBackup);
  const [baixando, setBaixando] = useState<string | null>(null);
  const salvar = async (id: string) => {
    if (!session || baixando) return;
    setBaixando(id);
    try {
      const resultado = await salvarBackupNoComputador(() =>
        baixar({ data: { id, accessToken: session.access_token } }),
      );
      if (resultado === "salvo") toast.success("Backup salvo no destino escolhido.");
      if (resultado === "iniciado")
        toast.success("Download iniciado. Confira a conclusão nos downloads do navegador.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o backup.");
    } finally {
      setBaixando(null);
    }
  };
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
        Cópia de todas as lojas, usuários, permissões, carteiras, estoques, histórico fiscal, banco
        de dados, código versionado e arquivos privados. Novas tabelas, funções e buckets de dados
        entram na próxima execução sem cadastro manual. O backup é criptografado e restrito à
        administração.
      </p>
      <p className="text-sm text-muted-foreground">
        A execução manual e a rotina diária dependem do executor e do armazenamento externo
        configurados. Uma solicitação aguardando executor ainda não é um backup concluído.
      </p>
      <p className="text-sm text-muted-foreground">
        Solicite a geração e, quando concluída e disponibilizada, use Salvar no computador no
        histórico. Em navegadores compatíveis, você escolhe a pasta e o nome; nos demais, vale a
        configuração de downloads do navegador. O pacote é criptografado: a chave de recuperação
        deve ser guardada separadamente pelo responsável.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => m.mutate()} disabled={m.isPending || ativo || !q.data}>
          {m.isPending
            ? "Solicitando..."
            : ativo
              ? "Backup em andamento ou na fila"
              : "Fazer backup manual"}
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
          <Table className="mobile-cards w-full text-left text-sm">
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
                  <td data-label="Solicitado (Brasília)" className="p-2">
                    {data(b.solicitado_em)}
                  </td>
                  <td data-label="Origem" className="p-2">
                    {b.origem === "manual" ? "Manual" : "Diário"}
                  </td>
                  <td data-label="Resultado" className="p-2">
                    <p>{estados[b.estado]}</p>
                    {b.estado === "sucesso" && b.download_disponivel && (
                      <Button
                        className="my-2"
                        variant="outline"
                        disabled={!!baixando}
                        onClick={() => void salvar(b.id)}
                      >
                        {baixando === b.id ? "Salvando…" : "Salvar no computador"}
                      </Button>
                    )}
                    {b.estado === "sucesso" && !b.download_disponivel && (
                      <p className="text-xs text-muted-foreground">
                        Download não disponibilizado pelo executor para esta cópia.
                      </p>
                    )}
                    {b.mensagem && <p className="text-xs text-muted-foreground">{b.mensagem}</p>}
                    {b.finalizado_em && (
                      <p className="text-xs">Finalizado: {data(b.finalizado_em)}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        A recuperação deve ser testada em ambiente separado pelo responsável técnico. Os arquivos
        são disponibilizados apenas a administradores, por link temporário. Chaves, configurações do
        provedor e serviços externos exigem guarda separada. Backups anteriores não são incluídos
        novamente no pacote.
      </p>
    </section>
  );
}
