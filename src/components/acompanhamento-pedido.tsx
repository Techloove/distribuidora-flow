import type { useAcompanhamentoPedido } from "@/lib/use-acompanhamento-pedido";
import { Check, RefreshCw } from "lucide-react";
import { dataAgenda } from "@/lib/agenda-comercial";
import { ETAPAS_PEDIDO, situacaoPedido } from "@/lib/status-pedido";
import { Button } from "@/components/ui/button";

export function AcompanhamentoPedido({
  acompanhamento: q,
}: {
  acompanhamento: ReturnType<typeof useAcompanhamentoPedido>;
}) {
  const { pode } = q;
  if (!pode) return null;
  const dados = q.isError ? null : q.data,
    situacao = dados ? situacaoPedido(dados.status) : null;
  return (
    <section
      aria-label="Acompanhamento do pedido"
      className="rounded-xl border bg-card p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Acompanhamento do pedido</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Consulta atualizada automaticamente a cada 30 segundos.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={q.isFetching}
          onClick={() => void q.refetch()}
        >
          <RefreshCw className={q.isFetching ? "size-4 animate-spin" : "size-4"} /> Atualizar
          andamento
        </Button>
      </div>
      {q.isPending && (
        <p role="status" className="text-sm">
          Carregando acompanhamento…
        </p>
      )}
      {q.error && (
        <p role="alert" className="text-sm text-destructive">
          {q.error.message}
        </p>
      )}
      {dados && situacao && (
        <>
          <div
            className={`rounded-lg p-3 ${situacao.atencao ? "bg-amber-50 text-amber-900" : dados.status === "entregue" ? "bg-emerald-50 text-emerald-900" : "bg-muted/50"}`}
          >
            <p className="font-semibold" role="status">
              {situacao.nome}
            </p>
            <p className="mt-1 text-sm">{situacao.descricao}</p>
          </div>
          {situacao.etapa != null && (
            <ol
              aria-label="Etapas do pedido"
              className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8"
            >
              {ETAPAS_PEDIDO.map((nome, indice) => {
                const atual = indice === situacao.etapa,
                  anterior = indice < situacao.etapa!;
                return (
                  <li
                    key={nome}
                    aria-current={atual ? "step" : undefined}
                    className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${atual ? "border-primary bg-primary/10 font-semibold" : anterior ? "bg-muted/40 text-muted-foreground" : "border-dashed text-muted-foreground"}`}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-5 shrink-0 items-center justify-center rounded-full border"
                    >
                      {anterior ? <Check className="size-3" /> : indice + 1}
                    </span>
                    <span className="pt-0.5">
                      {nome}
                      {atual && <span className="block text-[10px] text-primary">Etapa atual</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Data do pedido</dt>
              <dd>{dataAgenda(dados.data_pedido)}</dd>
            </div>
            {dados.carga_numero != null && (
              <div>
                <dt className="text-xs text-muted-foreground">Carga</dt>
                <dd>#{dados.carga_numero}</dd>
              </div>
            )}
            {dados.data_saida && (
              <div>
                <dt className="text-xs text-muted-foreground">Saída para entrega</dt>
                <dd>{dataAgenda(dados.data_saida)}</dd>
              </div>
            )}
            {dados.status !== "entregue" && dados.previsao_entrega && (
              <div>
                <dt className="text-xs text-muted-foreground">Previsão de entrega</dt>
                <dd>{dataAgenda(dados.previsao_entrega)}</dd>
              </div>
            )}
            {dados.status === "entregue" && (
              <>
                <div>
                  <dt className="text-xs text-muted-foreground">Data da entrega</dt>
                  <dd>
                    {dados.data_entrega
                      ? dataAgenda(dados.data_entrega)
                      : "Não informada no registro"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Recebido por</dt>
                  <dd className="break-words font-medium">
                    {dados.recebedor || "Recebedor não informado no registro"}
                  </dd>
                </div>
              </>
            )}
          </dl>
          {dados.possui_entrega_parcial && dados.status !== "entregue" && (
            <div className="rounded-lg border p-3 text-sm space-y-1">
              <p className="font-medium">Registro de entrega parcial ou recusa</p>
              {dados.ultima_visita && (
                <p>
                  Último registro em{" "}
                  {new Date(dados.ultima_visita).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}
                </p>
              )}
              {dados.recebedor_ultima_visita && (
                <p className="break-words">
                  Recebedor da última visita: {dados.recebedor_ultima_visita}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Este registro não representa a confirmação da entrega completa.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
