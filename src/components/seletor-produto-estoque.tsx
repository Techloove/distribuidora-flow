import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
type Produto = Record<string, unknown>;
export function SeletorProdutoEstoque({
  produtos,
  value,
  onChange,
  disabled = false,
  id,
}: {
  produtos: Produto[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  id: string;
}) {
  const [aberto, setAberto] = useState(false),
    [busca, setBusca] = useState("");
  const selecionado = produtos.find((p) => p["id"] === value);
  const encontrados = useMemo(() => {
    const normalizar = (s: unknown) =>
      String(s ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    const termo = normalizar(busca).trim();
    return produtos
      .filter((p) => !termo || normalizar(p["codigo"] + " " + p["descricao"]).includes(termo))
      .sort((a, b) => String(a["descricao"]).localeCompare(String(b["descricao"]), "pt-BR"));
  }, [produtos, busca]);
  return (
    <Popover
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) setBusca("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          aria-label="Selecionar produto"
          disabled={disabled}
          className="h-auto min-h-10 w-full justify-between text-left font-normal whitespace-normal"
        >
          <span>
            {selecionado
              ? `${selecionado["codigo"]} · ${selecionado["descricao"]}`
              : "Buscar por nome ou código"}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Digite o nome ou código..."
            value={busca}
            onValueChange={setBusca}
          />
          <CommandList>
            <CommandEmpty>Nenhum produto encontrado.</CommandEmpty>
            {encontrados.slice(0, 50).map((p) => (
              <CommandItem
                key={String(p["id"])}
                value={String(p["id"])}
                onSelect={() => {
                  onChange(String(p["id"]));
                  setAberto(false);
                  setBusca("");
                }}
              >
                <Check
                  className={`size-4 shrink-0 ${value === p["id"] ? "opacity-100" : "opacity-0"}`}
                />
                <span>
                  {String(p["codigo"])} · {String(p["descricao"])}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {String(p["unidade"] ?? "UN")}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
          {encontrados.length > 50 && (
            <p className="border-t p-2 text-xs text-muted-foreground">
              Digite mais para localizar entre {encontrados.length} produtos.
            </p>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
