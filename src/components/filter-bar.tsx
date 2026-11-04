import { FiltroPeriodo } from "./filtro-periodo";
import { paresDataFiltro, type CampoDataFiltro } from "@/lib/periodos-filtro";
import { SearchSelect } from "@/components/ui/search-select";
import { Children, Fragment, isValidElement, useId, useState } from "react";
import { ChevronDown, Filter, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Barra de filtros reutilizável em todas as telas do ERP. */
export function FilterBar({
  children,
  onClear,
  extra,
  periodosRapidos = true,
  permitirTodoPeriodo = true,
}: {
  children: React.ReactNode;
  onClear?: () => void;
  extra?: React.ReactNode;
  periodosRapidos?: boolean;
  permitirTodoPeriodo?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const [periodoSelecionado, setPeriodoSelecionado] = useState("");
  const campos: CampoDataFiltro[] = [];
  const ler = (nodes: React.ReactNode) =>
    Children.forEach(nodes, (n) => {
      if (!isValidElement(n)) return;
      const props = n.props as {
        children?: React.ReactNode;
        type?: string;
        label?: string;
        value?: string;
        onChange?: (v: string) => void;
      };
      if (n.type === Fragment) ler(props.children);
      else if (
        n.type === FilterText &&
        props.type === "date" &&
        typeof props.label === "string" &&
        props.onChange
      )
        campos.push({ label: props.label, value: props.value ?? "", onChange: props.onChange });
    });
  if (periodosRapidos) ler(children);
  const periodos = paresDataFiltro(campos);
  const periodo = periodos.find((p) => p.label === periodoSelecionado) ?? periodos[0];
  return (
    <div className="no-print rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="sm:hidden"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
        >
          <Filter className="size-3.5" />
          {expanded ? "Recolher filtros" : "Mostrar filtros"}
          <ChevronDown className={expanded ? "size-3.5 rotate-180" : "size-3.5"} />
        </Button>
        <p className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Filter className="size-3.5" /> Filtros
        </p>
        <div className="flex max-w-full flex-wrap items-center gap-2 [&>div]:flex-wrap">
          {extra}
          {onClear ? (
            <Button size="sm" variant="ghost" onClick={onClear}>
              <X className="size-3.5" /> Limpar
            </Button>
          ) : null}
        </div>
      </div>
      {periodo && (
        <div className="mb-3 space-y-2">
          {periodos.length > 1 && (
            <div className="max-w-sm space-y-1">
              <label htmlFor={`${id}-periodo`} className="text-xs text-muted-foreground">
                Aplicar atalhos em
              </label>
              <select
                id={`${id}-periodo`}
                className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                value={periodo.label}
                onChange={(e) => setPeriodoSelecionado(e.target.value)}
              >
                {periodos.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Os atalhos alteram somente esse campo; os demais filtros continuam aplicados.
              </p>
            </div>
          )}
          <FiltroPeriodo
            permitirTodoPeriodo={permitirTodoPeriodo}
            label={periodo.label}
            de={periodo.de.value}
            ate={periodo.ate.value}
            onChange={(de, ate) => {
              periodo.de.onChange(de);
              periodo.ate.onChange(ate);
            }}
          />
        </div>
      )}
      <div
        id={id}
        className={`${expanded ? "grid" : "hidden sm:grid"} min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0`}
      >
        {children}
      </div>
    </div>
  );
}

export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "Todos",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; search?: string }[];
  allLabel?: string;
}) {
  return (
    <FilterField label={label}>
      <SearchSelect
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} data-search={o.search}>
            {o.label}
          </option>
        ))}
      </SearchSelect>
    </FilterField>
  );
}

export function FilterText({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  currency,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  currency?: boolean;
}) {
  return (
    <FilterField label={label}>
      <Input
        currency={currency}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 bg-background text-sm"
      />
    </FilterField>
  );
}
