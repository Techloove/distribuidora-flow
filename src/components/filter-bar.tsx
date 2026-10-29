import { useId, useState } from "react";
import { ChevronDown, Filter, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Barra de filtros reutilizável em todas as telas do ERP. */
export function FilterBar({
  children,
  onClear,
  extra,
}: {
  children: React.ReactNode;
  onClear?: () => void;
  extra?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
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
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <FilterField label={label}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FilterField>
  );
}

export function FilterText({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <FilterField label={label}>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 bg-background text-sm"
      />
    </FilterField>
  );
}
