import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { sicoobStatusAutomatico } from "@/lib/sicoob.functions";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { dataHoraBr } from "@/lib/formatacao";
export function SicoobAutomatico({ centroId }: { centroId: string }) {
  const qc = useQueryClient();
  const anterior = useRef<string | null>(null);
  const { session } = useSupabase();
  const permissoes = usePermissoesRotinas();
  const status = useServerFn(sicoobStatusAutomatico);
  const q = useQuery({
    queryKey: ["sicoob-auto-status", session?.user.id, centroId],
    enabled: !!session && !!centroId && permissoes.pode("sicoob_operar"),
    refetchInterval: 60000,
    retry: false,
    queryFn: () => status({ data: { accessToken: session!.access_token, centroId } }),
  });
  const ultimaConsulta = q.data?.ultimaConsulta;
  const ultimaLiqui = q.data?.ultimaLiqui;
  useEffect(() => {
    const atual =
      ultimaConsulta || ultimaLiqui ? JSON.stringify([ultimaConsulta, ultimaLiqui]) : null;
    if (anterior.current && atual && anterior.current !== atual)
      void Promise.all(
        ["boletos", "contas_receber", "vw_titulos_receber", "movimentos_financeiros"].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      );
    anterior.current = atual;
  }, [ultimaConsulta, ultimaLiqui, qc]);
  if (!permissoes.pode("sicoob_operar")) return null;
  return (
    <div className="rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground">
      {q.isError ? (
        <p>
          Consulta automática Sicoob indisponível. Solicite ao administrador a verificação do
          agendamento e da configuração da loja.
        </p>
      ) : q.data ? (
        <>
          <p>
            Consulta automática Sicoob: {q.data.ativo ? "ativa" : "pausada"}. Última consulta dos
            boletos:{" "}
            {q.data.ultimaConsulta
              ? dataHoraBr(q.data.ultimaConsulta)
              : "aguardando primeira consulta"}
            .
          </p>
          {q.data.falhas > 0 && (
            <p className="text-amber-700">
              {q.data.falhas} boleto(s) aguardando nova tentativa após falha de consulta. O último
              estado confirmado foi preservado.
            </p>
          )}
          <p>
            Em aberto: consultas a cada quinze minutos, incluindo vencimentos futuros. Já
            liquidados: nova conferência a cada seis horas. Falhas podem ampliar o intervalo entre
            tentativas. Tarifas seguem a configuração de importação do extrato da loja.
          </p>
          {q.data.baixarFinanceiro ? (
            <>
              <p>
                Baixa financeira por arquivos de liquidação: ativa. Último ciclo concluído:{" "}
                {q.data.ultimaLiqui
                  ? dataHoraBr(q.data.ultimaLiqui)
                  : "aguardando primeiro retorno"}
                .
              </p>
              {q.data.erroLiqui && (
                <p className="text-amber-700">
                  Coleta de liquidações aguardando nova tentativa: {q.data.erroLiqui}.
                </p>
              )}
              {!!q.data.pendenciasLiqui && (
                <p className="text-amber-700">
                  {q.data.pendenciasLiqui} liquidação(ões) exige(m) conferência antes de registrar o
                  recebimento.
                </p>
              )}
            </>
          ) : (
            <p>
              A baixa financeira automática por arquivos de liquidação ainda não está habilitada
              nesta loja.
            </p>
          )}
        </>
      ) : (
        <p>Verificando consulta automática Sicoob…</p>
      )}
    </div>
  );
}
