import * as React from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "./popover";
import { Input } from "./input";
import { cn } from "@/lib/utils";
import { correspondeBuscaSelecao } from "@/lib/busca-selecao";

type Opcao = { value: string; label: string; busca: string; disabled: boolean; detail: string };
type Props = Omit<React.ComponentProps<"select">, "multiple" | "size">;
function texto(node: React.ReactNode): string {
  return React.Children.toArray(node)
    .map((n) =>
      React.isValidElement<{ children?: React.ReactNode }>(n) ? texto(n.props.children) : String(n),
    )
    .join("");
}
function opcoes(node: React.ReactNode, desabilitado = false): Opcao[] {
  return React.Children.toArray(node).flatMap((n) => {
    if (
      !React.isValidElement<{
        value?: string | number;
        children?: React.ReactNode;
        disabled?: boolean;
        hidden?: boolean;
        "data-search"?: string;
        "data-detail"?: string;
      }>(n)
    )
      return [];
    if (n.type === "option") {
      if (n.props.hidden) return [];
      const label = texto(n.props.children);
      return [
        {
          value: String(n.props.value ?? label),
          label,
          busca: label + " " + (n.props["data-search"] ?? ""),
          disabled: desabilitado || !!n.props.disabled,
          detail: n.props["data-detail"] ?? "",
        },
      ];
    }
    return opcoes(n.props.children, desabilitado || !!n.props.disabled);
  });
}

/** Substitui listas de referências preservando IDs, eventos, permissões e opções já carregadas. */
export function SearchSelect({
  children,
  value,
  defaultValue,
  onChange,
  id,
  className,
  disabled,
  required,
  name,
  title,
  ...props
}: Props) {
  const uid = React.useId(),
    inputId = id ?? uid,
    listId = `${uid}-resultados`;
  const anchor = React.useRef<HTMLDivElement>(null);
  const native = React.useRef<HTMLSelectElement>(null),
    input = React.useRef<HTMLInputElement>(null);
  const [local, setLocal] = React.useState(String(defaultValue ?? ""));
  const selecionado = value === undefined ? local : String(value ?? "");
  const [open, setOpen] = React.useState(false),
    [busca, setBusca] = React.useState(""),
    [ativo, setAtivo] = React.useState(-1),
    [limite, setLimite] = React.useState(50);
  const [rotulo, setRotulo] = React.useState("");
  const ariaLabel = props["aria-label"],
    ariaLabelledby = props["aria-labelledby"];
  const lista = React.useMemo(() => opcoes(children), [children]);
  const atual = lista.find((o) => o.value === selecionado),
    vazio = lista.find((o) => o.value === "");
  const encontrados = React.useMemo(
    () => lista.filter((o) => correspondeBuscaSelecao(o.busca, busca)),
    [lista, busca],
  );
  const visiveis = encontrados.slice(0, limite);
  React.useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  React.useEffect(() => {
    setBusca("");
    setAtivo(-1);
    setLimite(50);
  }, [selecionado]);
  React.useEffect(() => {
    if (!ariaLabel && !ariaLabelledby) {
      const label =
        input.current?.closest("label") ??
        input.current?.parentElement?.parentElement?.querySelector("label");
      const copia = label?.cloneNode(true) as HTMLElement | undefined;
      copia?.querySelectorAll("select,input,button").forEach((n) => n.remove());
      setRotulo(copia?.textContent?.replace(/\s+/g, " ").trim() ?? "");
    }

    input.current?.setCustomValidity(
      required && (!selecionado || !atual || atual.disabled)
        ? "Selecione um resultado da busca."
        : "",
    );
  }, [required, selecionado, atual, ariaLabel, ariaLabelledby]);
  React.useEffect(() => {
    if (ativo >= 0)
      document.getElementById(`${listId}-${ativo}`)?.scrollIntoView({ block: "nearest" });
  }, [ativo, listId]);
  function escolher(o: Opcao) {
    if (disabled || o.disabled || !native.current) return;
    setLocal(o.value);
    setOpen(false);
    setBusca("");
    setAtivo(-1);
    native.current.value = o.value;
    native.current.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function mover(direcao: number) {
    setOpen(true);
    let i = ativo < 0 && direcao < 0 ? visiveis.length : ativo;
    do {
      i += direcao;
    } while (i >= 0 && i < visiveis.length && visiveis[i]?.disabled);
    if (i >= 0 && i < visiveis.length) setAtivo(i);
  }
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setBusca("");
          setAtivo(-1);
        }
      }}
    >
      <select
        {...props}
        ref={native}
        aria-hidden="true"
        tabIndex={-1}
        name={name}
        disabled={disabled}
        value={selecionado}
        onChange={onChange}
        className="hidden"
        data-search-select-value="true"
      >
        {children}
      </select>
      <PopoverAnchor asChild>
        <div ref={anchor} className="relative min-w-0 max-w-full">
          <Input
            ref={input}
            id={inputId}
            role="combobox"
            aria-label={props["aria-label"] ?? (rotulo || undefined)}
            aria-labelledby={props["aria-labelledby"]}
            aria-describedby={props["aria-describedby"]}
            aria-expanded={open && !disabled}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && ativo >= 0 ? `${listId}-${ativo}` : undefined}
            autoComplete="off"
            disabled={disabled}
            required={required}
            title={title ?? atual?.label}
            placeholder={open ? "Digite para buscar…" : vazio?.label || "Digite para buscar…"}
            value={
              open ? busca : atual?.value ? atual.label : selecionado ? "Registro indisponível" : ""
            }
            className={cn(
              "h-9 w-full truncate rounded-md border border-input bg-background px-3 pr-9 text-sm",
              className,
            )}
            onFocus={() => {
              setOpen(true);
              setBusca("");
              setAtivo(-1);
              setLimite(50);
            }}
            onClick={() => {
              if (!open) {
                setOpen(true);
                setBusca("");
                setAtivo(-1);
                setLimite(50);
              }
            }}
            onChange={(e) => {
              setBusca(e.target.value);
              setAtivo(-1);
              setLimite(50);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                mover(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (!open) {
                  setOpen(true);
                  let ultimo = visiveis.length - 1;
                  while (ultimo >= 0 && visiveis[ultimo]?.disabled) ultimo--;
                  setAtivo(ultimo);
                } else mover(-1);
              } else if (e.key === "Enter") {
                e.preventDefault();
                const o =
                  ativo >= 0
                    ? visiveis[ativo]
                    : busca.trim()
                      ? visiveis.find((o) => !o.disabled && o.value !== "")
                      : undefined;
                if (open && o) escolher(o);
                else setOpen(!open);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                setBusca("");
                setAtivo(-1);
              } else if (e.key === "Tab") {
                setOpen(false);
                setBusca("");
                setAtivo(-1);
              }
            }}
          />
          {vazio && selecionado && !disabled ? (
            <button
              type="button"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:bg-muted"
              aria-label={`Limpar ${props["aria-label"] ?? (rotulo || "seleção")}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => escolher(vazio)}
            >
              <X className="size-4" />
            </button>
          ) : (
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        role="presentation"
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-1"
        onInteractOutside={(e) => {
          if (e.target instanceof Node && anchor.current?.contains(e.target)) e.preventDefault();
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div
          id={listId}
          role="listbox"
          aria-label={props["aria-label"] ?? (rotulo || "Resultados da busca")}
          className="max-h-[min(18rem,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain"
        >
          {visiveis.map((o, i) => (
            <div
              key={`${o.value}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === selecionado}
              aria-disabled={o.disabled}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm",
                ativo === i && "bg-accent",
                o.disabled && "cursor-not-allowed opacity-50",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setAtivo(i)}
              onClick={() => escolher(o)}
            >
              <span className="min-w-0 flex-1 break-words">{o.label}</span>
              {o.detail && (
                <span className="shrink-0 text-xs text-muted-foreground">{o.detail}</span>
              )}
              {o.value === selecionado && <Check className="size-4 shrink-0 text-primary" />}
            </div>
          ))}
          {!visiveis.length && (
            <p className="px-3 py-5 text-sm text-muted-foreground">
              Nenhum resultado. Tente outro nome ou código.
            </p>
          )}
        </div>
        <div role="status" className="border-t px-3 py-2 text-xs text-muted-foreground">
          {encontrados.length} resultado(s)
          {encontrados.length > limite && (
            <button
              type="button"
              className="ml-2 font-medium text-primary underline"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setLimite((n) => n + 50)}
            >
              Mostrar mais
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
