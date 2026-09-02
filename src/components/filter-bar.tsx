import { Filter, X } from "lucide-react";

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
  return (
    <div className="no-print rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Filter className="size-3.5" /> Filtros
        </p>
        <div className="flex items-center gap-2">
          {extra}
          {onClear ? (
            <Button size="sm" variant="ghost" onClick={onClear}>
              <X className="size-3.5" /> Limpar
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  );
}

export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
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
