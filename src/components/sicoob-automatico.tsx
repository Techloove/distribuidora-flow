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
  useEffect(() => {
    const atual = q.data?.ultimaConsulta ?? null;
    if (anterior.current && atual && anterior.current !== atual)
      void qc.invalidateQueries({ queryKey: ["boletos"] });
    anterior.current = atual;
  }, [q.data?.ultimaConsulta, qc]);
  if (!permissoes.pode("sicoob_operar")) return null;
  return (
    <div className="rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground">
      {q.isError ? (
        <p>
          Consulta automática Sicoob indisponível. Confira a instalação da fase358 e a configuração
          da loja.
        </p>
      ) : q.data ? (
        <>
          <p>
            Consulta automática Sicoob: {q.data.ativo ? "ativa" : "pausada"}. Última conferência:{" "}
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
            Consulta também boletos com vencimento futuro. Liquidação bancária ainda exige
            conferência do valor e da data para baixa no financeiro. Tarifas seguem a configuração
            de importação da loja.
          </p>
        </>
      ) : (
        <p>Verificando consulta automática Sicoob…</p>
      )}
    </div>
  );
}
