import { ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { alternarStatusSelecionado, statusSelecionados } from "@/lib/filtro-status-documento";

export function FiltroStatusDocumento({
  valor,
  onChange,
  opcoes,
}: {
  valor: string;
  onChange: (valor: string) => void;
  opcoes: { value: string; label: string }[];
}) {
  const selecionados = statusSelecionados(valor);
  const nomes = opcoes.filter((o) => selecionados.has(o.value)).map((o) => o.label);
  return (
    <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
      <span>Status</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            aria-label="Status"
            variant="outline"
            className="h-9 w-full justify-between bg-background font-normal"
            title={nomes.join(", ") || "Todos"}
          >
            <span className="truncate">{nomes.join(", ") || "Todos"}</span>
            <ChevronDown className="size-4 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-3">
          <p className="text-sm font-medium">Selecione uma ou mais situações</p>
          <Button
            size="sm"
            variant={selecionados.size ? "outline" : "secondary"}
            onClick={() => onChange("")}
          >
            Todos os status
          </Button>
          <div className="max-h-72 overflow-y-auto" role="group" aria-label="Situações do pedido">
            {opcoes.map((o) => (
              <label
                key={o.value}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selecionados.has(o.value)}
                  onChange={() => onChange(alternarStatusSelecionado(valor, o.value))}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Sem marcações, todos os status são exibidos.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
