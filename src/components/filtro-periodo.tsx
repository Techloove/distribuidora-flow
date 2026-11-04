import { useId, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { atalhosPeriodo, intervaloMes, mesDoIntervalo } from "@/lib/periodos-filtro";
import { moverMesDashboard } from "@/lib/periodo-dashboard";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { dataBr } from "@/lib/formatacao";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function FiltroPeriodo({
  de,
  ate,
  onChange,
  label = "Datas",
  hoje = hojeSaoPaulo(),
  permitirTodoPeriodo = true,
}: {
  de: string;
  ate: string;
  onChange: (de: string, ate: string) => void;
  label?: string;
  hoje?: string;
  permitirTodoPeriodo?: boolean;
}) {
  const id = useId(),
    presets = atalhosPeriodo(hoje).filter((p) => permitirTodoPeriodo || p.id !== "todos"),
    [ultimo, setUltimo] = useState("");
  const mesmo = (p: (typeof presets)[number]) => p.de === de && p.ate === ate;
  const ativo = presets.find((p) => p.id === ultimo && mesmo(p)) ?? presets.find(mesmo);
  const mes = mesDoIntervalo(de, ate),
    referencia = mes || (ate || de || hoje).slice(0, 7);
  const escolherMes = (valor: string) => {
    if (!valor) return;
    try {
      const p = intervaloMes(valor);
      setUltimo("");
      onChange(p.de, p.ate);
    } catch {
      /* Entrada incompleta não muda o filtro. */
    }
  };
  return (
    <section
      aria-label={`Período de ${label}`}
      className="no-print min-w-0 space-y-3 rounded-xl border border-border/70 bg-background/60 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <CalendarRange className="size-4 shrink-0" />
          {label} ·{" "}
          {de || ate
            ? `${de ? dataBr(de) : "Sem início"} a ${ate ? dataBr(ate) : "Sem fim"}`
            : "Todo o período"}
        </p>
        <div className="flex min-w-0 items-center gap-1">
          <Label className="shrink-0 text-xs text-muted-foreground" htmlFor={id}>
            Mês<span className="sr-only"> de {label}</span>
          </Label>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Mês anterior de ${label}`}
            disabled={referencia === "1000-01"}
            onClick={() => escolherMes(moverMesDashboard(referencia, -1))}
          >
            <ChevronLeft />
          </Button>
          <Input
            id={id}
            type="month"
            min="1000-01"
            max="9999-12"
            value={mes}
            onChange={(e) => escolherMes(e.target.value)}
            className="h-9 w-32 text-center"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Próximo mês de ${label}`}
            disabled={referencia === "9999-12"}
            onClick={() => escolherMes(moverMesDashboard(referencia, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Atalhos de ${label}`}>
        {presets.map((p) => (
          <Button
            key={p.id}
            type="button"
            size="sm"
            variant={ativo?.id === p.id ? "default" : "secondary"}
            aria-pressed={ativo?.id === p.id}
            onClick={() => {
              setUltimo(p.id);
              onChange(p.de, p.ate);
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
