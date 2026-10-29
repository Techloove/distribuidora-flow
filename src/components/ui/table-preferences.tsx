import { useEffect, useId, useState, type RefObject } from "react";
import { useColumnPreferences } from "@/lib/use-column-preferences";
import { Columns3 } from "lucide-react";
import { useSupabase } from "@/lib/supabase-provider";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/** Observa somente a estrutura: funciona também com cabeçalhos dinâmicos e tabelas legadas. */
export function TablePreferences({
  table,
  scope,
}: {
  table: RefObject<HTMLTableElement | null>;
  scope?: string;
}) {
  const { user } = useSupabase();
  const id = `cols-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [columns, setColumns] = useState<{ name: string; index: number; key: string }[]>([]);
  const [path, setPath] = useState("");
  useEffect(() => {
    const el = table.current;
    if (!el) return;
    el.dataset["columnScope"] = id;
    setPath(window.location.pathname);
    const read = () => {
      const heads = Array.from(el.tHead?.rows[el.tHead.rows.length - 1]?.cells ?? []);
      // Cabeçalhos agrupados exigem uma definição própria de colunas; não oculta posições ambíguas.
      const next = heads.some((h) => h.colSpan > 1 || h.rowSpan > 1)
        ? []
        : heads.flatMap((h, index) => {
            const name = (h.getAttribute("data-column-label") ?? h.textContent ?? "")
              .replace(/\s+/g, " ")
              .trim();
            return !name || /^(ações|ação|selecionar|seleção|opções)$/i.test(name)
              ? []
              : [
                  {
                    name,
                    index: index + 1,
                    key: `${name}:${heads.slice(0, index).filter((x) => x.textContent?.trim() === name).length}`,
                  },
                ];
          });
      setColumns((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [table, id]);
  const screen = scope ?? `${path}:${columns.map((c) => c.key).join("|")}`;
  const { saved, save } = useColumnPreferences(screen, !!path && columns.length > 1);
  const hidden = saved.data ?? [];
  if (!user || columns.length < 2) return null;
  const rules = columns
    .filter((c) => hidden.includes(c.key))
    .map(
      (c) =>
        `[data-column-scope="${id}"] > thead > tr > :nth-child(${c.index}),[data-column-scope="${id}"] > tbody > tr:not(:has([colspan])) > :nth-child(${c.index}),[data-column-scope="${id}"] > tfoot > tr:not(:has([colspan])) > :nth-child(${c.index}){display:none!important}`,
    )
    .join("\n");
  return (
    <div className="no-print mb-2 flex justify-end">
      <style>{rules}</style>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline">
            <Columns3 className="size-4" />
            Colunas
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="max-h-[70dvh] w-72 overflow-auto">
          <p className="mb-3 text-sm text-muted-foreground">
            Salvas na sua conta, para esta lista.
          </p>
          {saved.isError && (
            <p role="alert" className="mb-2 text-sm text-destructive">
              {saved.error.message}
              <button className="ml-1 underline" onClick={() => void saved.refetch()}>
                Tentar novamente
              </button>
            </p>
          )}
          {columns.map((c) => (
            <label key={c.key} className="flex items-start gap-2 py-2 text-sm">
              <input
                type="checkbox"
                checked={!hidden.includes(c.key)}
                disabled={
                  !saved.isSuccess ||
                  save.isPending ||
                  (!hidden.includes(c.key) &&
                    columns.filter((x) => !hidden.includes(x.key)).length === 1)
                }
                onChange={(e) =>
                  save.mutate(
                    e.target.checked ? hidden.filter((v) => v !== c.key) : [...hidden, c.key],
                  )
                }
              />
              {c.name}
            </label>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={!saved.isSuccess || save.isPending || !hidden.length}
            onClick={() => save.mutate([])}
          >
            Restaurar colunas
          </Button>
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {save.isPending
              ? "Salvando…"
              : saved.isPending
                ? "Carregando…"
                : save.isError
                  ? "Falha ao salvar. Sua última configuração foi mantida."
                  : "Ações e seleção permanecem disponíveis."}
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
