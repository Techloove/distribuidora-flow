import * as React from "react";
import { mesBr } from "@/lib/formatacao";

/** Mostra MM/AAAA, mantendo AAAA-MM no contrato dos formulários e filtros. */
export const InputMes = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ value, defaultValue, onChange, onBlur, ...props }, ref) => {
    const original = String(value ?? defaultValue ?? "");
    const [texto, setTexto] = React.useState(original ? mesBr(original) : "");
    React.useEffect(() => setTexto(original ? mesBr(original) : ""), [original]);
    return (
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode="numeric"
        placeholder="MM/AAAA"
        pattern="(0[1-9]|1[0-2])/[0-9]{4}"
        maxLength={7}
        value={texto}
        onChange={(e) => {
          const raw = e.target.value;
          const digits = raw.replace(/\D/g, "").slice(0, 6);
          const next = /^\d{4}-\d{1,2}$/.test(raw)
            ? mesBr(raw)
            : digits.length > 2
              ? digits.slice(0, 2) + "/" + digits.slice(2)
              : digits;
          setTexto(next);
          const match = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec(next);
          e.target.setCustomValidity("");
          if (!next || match) {
            const iso = match ? `${match[2]}-${match[1]}` : "";
            if (
              iso &&
              ((props.min && iso < String(props.min)) || (props.max && iso > String(props.max)))
            ) {
              e.target.setCustomValidity("Mês fora do período permitido.");
              return;
            }
            const target = new Proxy(e.target, {
              get(t, k) {
                if (k === "value") return iso;
                const v = Reflect.get(t, k, t);
                return typeof v === "function" ? v.bind(t) : v;
              },
            });
            const event = new Proxy(e, {
              get(t, k) {
                return k === "target" || k === "currentTarget" ? target : Reflect.get(t, k, t);
              },
            });
            onChange?.(event);
          }
        }}
        onBlur={(e) => {
          if (!e.target.validity.valid || (!e.target.value && original)) {
            setTexto(original ? mesBr(original) : "");
            e.target.setCustomValidity("");
          }
          onBlur?.(e);
        }}
      />
    );
  },
);
InputMes.displayName = "InputMes";
