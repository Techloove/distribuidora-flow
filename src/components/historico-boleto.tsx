import type { EventoBoleto } from "@/lib/boleto-apresentacao";
import { estadosEventoBoleto } from "@/lib/boleto-apresentacao";
import { brl, dataBr, dataHoraBr } from "@/lib/formatacao";
export function HistoricoBoleto({ eventos, banco }: { eventos: EventoBoleto[]; banco: string }) {
  if (!eventos.length) return null;
  return (
    <details className="my-3 rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Histórico do boleto · {banco}</summary>
      <ol className="mt-3 space-y-3" aria-label="Histórico bancário do boleto">
        {eventos.map((e) => (
          <li key={`${e.tipo}-${e.id}`} className="rounded-md border p-3">
            <p className="font-medium">
              {e.titulo} · {estadosEventoBoleto[e.estado] ?? "Conferir situação"}
            </p>
            <p className="text-xs text-muted-foreground">
              Solicitada em {dataHoraBr(e.criadoEm)}
              {e.estado === "confirmado" ? ` · Confirmada em ${dataHoraBr(e.atualizadoEm)}` : ""}
            </p>
            {e.tipo === "vencimento" && (
              <p>
                {dataBr(e.anterior["vencimento"])} → {dataBr(e.esperado["vencimento"])}
              </p>
            )}
            {e.tipo === "abatimento" && (
              <p>
                Abatimento: {brl(e.anterior["abatimento"])} → {brl(e.esperado["abatimento"])}
              </p>
            )}
            {["desconto", "data_desconto"].includes(e.tipo) &&
              Array.isArray(e.esperado["descontos"]) && (
                <p className="text-xs">
                  Condições de desconto solicitadas:{" "}
                  {(e.esperado["descontos"] as Record<string, unknown>[])
                    .map(
                      (d) =>
                        `${e.esperado["tipoDesconto"] === "PERCENTUAL" || e.esperado["tipoDesconto"] === 2 ? `${Number(d["valor"]).toLocaleString("pt-BR")}%` : e.esperado["tipoDesconto"] === "VALOR" || e.esperado["tipoDesconto"] === 1 ? brl(d["valor"]) : "Regra bancária"} até ${dataBr(d["data"])}`,
                    )
                    .join("; ") || "Sem desconto"}
                </p>
              )}
            {e.motivo && <p className="whitespace-pre-wrap break-words">Motivo: {e.motivo}</p>}
            {e.nota && (
              <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {e.nota}
              </p>
            )}
            {e.estado !== "confirmado" && (
              <p className="text-xs text-muted-foreground">
                Esta solicitação não representa uma alteração confirmada.
              </p>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
