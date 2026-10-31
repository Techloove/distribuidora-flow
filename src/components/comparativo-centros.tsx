import { getModalidade } from "@/lib/modalidade-store";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSupabaseAnalitico as useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { brl } from "@/lib/formatacao";
import type { Registro } from "@/lib/rotinas-distribuidora";
import { Input } from "./ui/input";
import { exportarCsv } from "@/lib/exportar";
import { Button } from "./ui/button";
export function ComparativoCentros() {
  const { client, user } = useSupabase(),
    perm = usePermissoesRotinas();
  const hoje = hojeSaoPaulo(),
    [inicio, setInicio] = useState(hoje.slice(0, 7) + "-01"),
    [fim, setFim] = useState(hoje);
  const q = useQuery({
    queryKey: [...["comparativo_centros", user?.id, inicio, fim], getModalidade()],
    enabled: !!client && perm.pode("indicadores_comparar") && !!inicio && !!fim,
    queryFn: async () => {
      const { data, error } = await client!.rpc("comparativo_centros_220", {
        _inicio: inicio,
        _fim: fim,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as Registro[];
    },
  });
  if (!perm.pode("indicadores_comparar")) return null;
  return (
    <section className="mb-4 rounded border p-4 space-y-3">
      <h2 className="font-semibold">Comparativo de períodos e centros</h2>
      <p className="text-xs text-muted-foreground">
        Período escolhido versus intervalo imediatamente anterior com a mesma duração. Vendas pela
        data do pedido; contribuição após produtos, comissão e transporte. Resultado estimado
        desconta tributos e despesas variáveis informados, antes das despesas fixas. Não é lucro
        contábil.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Início do comparativo"
          type="date"
          value={inicio}
          onChange={(e) => setInicio(e.target.value)}
        />
        <Input
          aria-label="Fim do comparativo"
          type="date"
          value={fim}
          onChange={(e) => setFim(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={!q.data?.length}
          onClick={() =>
            exportarCsv(
              "comparativo-centros",
              ["centro", "periodo", "pedidos", "vendas", "contribuicao", "resultado_estimado"].map(
                (key) => ({ key, label: key }),
              ),
              q.data ?? [],
            )
          }
        >
          Exportar comparativo
        </Button>
      </div>
      {q.isPending && <p className="text-sm">Calculando…</p>}
      {q.error && (
        <p role="alert" className="text-destructive">
          {q.error.message}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {q.data?.map((r) => (
          <article
            key={String(r["centro_id"]) + r["periodo"]}
            className="rounded border p-3 text-sm"
          >
            <strong>
              {String(r["centro"])} · {r["periodo"] === "atual" ? "Atual" : "Anterior"}
            </strong>
            <p>
              {String(r["pedidos"])} pedidos · vendas {brl(r["vendas"])}
            </p>
            <p>
              Contribuição {brl(r["contribuicao"])} · resultado estimado{" "}
              {brl(r["resultado_estimado"])}
            </p>
          </article>
        ))}
      </div>
      {q.data?.length === 0 && <p className="text-sm">Sem pedidos nos períodos escolhidos.</p>}
    </section>
  );
}
