import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import {
  progressoDescontoPeso,
  type FaixaPeso,
  type ItemPeso,
} from "@/lib/progresso-desconto-peso";
import { useSupabase } from "@/lib/supabase-provider";

const numero = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
export function ProgressoDescontoPeso({
  itens,
  carregando,
  erro,
}: {
  itens: ItemPeso[];
  carregando: boolean;
  erro: boolean;
}) {
  const { client, user } = useSupabase();
  const faixas = useQuery({
    queryKey: ["desconto_faixas_peso", "progresso", user?.id],
    enabled: !!client && !!user,
    queryFn: async () => {
      const { data, error } = await client!
        .from("desconto_faixas_peso")
        .select("id, nome, categoria, peso_min, peso_max, percentual, ordem, ativo")
        .eq("ativo", true)
        .order("ordem")
        .order("peso_min");
      if (error) throw new Error(error.message);
      return (data ?? []) as FaixaPeso[];
    },
  });
  if (carregando || faixas.isPending)
    return (
      <p className="text-sm text-muted-foreground">Conferindo a próxima faixa de desconto...</p>
    );
  if (erro || faixas.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível conferir as faixas de desconto por peso.
      </p>
    );
  const progresso = progressoDescontoPeso(itens, faixas.data ?? []);
  if (!progresso.temFaixas) return null;
  return (
    <section
      aria-label="Progresso do desconto por peso"
      className="rounded-lg border border-primary/20 bg-primary/5 p-4"
    >
      <div className="flex items-center gap-2">
        <Scale className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">Próxima faixa de desconto</h3>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="mt-2 space-y-3 text-sm">
        <p>
          Peso do pedido: <strong>{numero(progresso.pesoTotal)} kg</strong>.{" "}
          {progresso.atual ? (
            <>
              Faixa atual:{" "}
              <strong>
                {progresso.atual.nome} · {numero(Number(progresso.atual.percentual))}%
              </strong>
              .
            </>
          ) : (
            "Nenhuma faixa atingida ainda."
          )}
        </p>
        {progresso.proximas.map(({ faixa, pesoAtual, meta, falta }) => (
          <div key={faixa.id}>
            <p>
              Faltam <strong className="text-primary">{numero(falta)} kg</strong>
              {faixa.categoria !== null ? (
                <>
                  {" "}
                  da categoria <strong>{faixa.categoria || "sem categoria"}</strong>
                </>
              ) : null}{" "}
              para atingir <strong>{faixa.nome}</strong>, com{" "}
              <strong>{numero(Number(faixa.percentual))}% de desconto</strong>.
            </p>
            <progress
              aria-label={`Progresso para ${faixa.nome}`}
              max={meta}
              value={pesoAtual}
              className="mt-2 h-2 w-full accent-primary"
            />
          </div>
        ))}
        {!progresso.proximas.length && (
          <p>
            {progresso.maiorAtingida
              ? "Você atingiu a maior faixa de desconto disponível para os produtos deste pedido."
              : "Não há uma próxima faixa de desconto disponível para os produtos deste pedido."}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          O aviso acompanha os itens salvos. Use “Aplicar desconto no pedido” para aplicar a faixa
          atingida.
        </p>
      </div>
    </section>
  );
}
