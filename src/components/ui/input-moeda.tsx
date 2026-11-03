import * as React from "react";
import { formatarEntradaMoeda, normalizarEntradaMoeda } from "@/lib/entrada-moeda";

type Props = React.ComponentProps<"input">;

/** Mantém o contrato numérico dos formulários existentes; o DOM exibe a escrita brasileira. */
function eventoNumerico<T extends React.SyntheticEvent<HTMLInputElement>>(
  evento: T,
  valor: string,
  restaurar: (valor: string) => void,
): T {
  const alvo = new Proxy(evento.target as HTMLInputElement, {
    set(target, key, novo) {
      if (key === "value") {
        const valor = normalizarEntradaMoeda(String(novo)) ?? "";
        restaurar(valor);
        return Reflect.set(target, key, formatarEntradaMoeda(valor), target);
      }
      return Reflect.set(target, key, novo, target);
    },
    get(target, key) {
      if (key === "value") return valor;
      const v = Reflect.get(target, key, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return new Proxy(evento, {
    get(target, key) {
      if (key === "target" || key === "currentTarget") return alvo;
      const v = Reflect.get(target, key, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

export const InputMoeda = React.forwardRef<HTMLInputElement, Props>(
  ({ value, defaultValue, onChange, onBlur, onFocus, type: _type, ...props }, ref) => {
    const recebido = value ?? defaultValue ?? "";
    const origem =
      typeof recebido === "string" ? (normalizarEntradaMoeda(recebido) ?? recebido) : recebido;
    const [texto, setTexto] = React.useState(() => formatarEntradaMoeda(origem));
    const foco = React.useRef(false);
    const canonico = React.useRef(String(origem));
    React.useEffect(() => {
      if (!foco.current) {
        canonico.current = String(origem);
        setTexto(formatarEntradaMoeda(origem));
      }
    }, [origem]);
    const restaurar = (valor: string) => {
      canonico.current = valor;
      setTexto(formatarEntradaMoeda(valor));
    };
    const validar = (input: HTMLInputElement, valor: string) => {
      const n = Number(valor);
      const menor = valor !== "" && props.min !== undefined && n < Number(props.min);
      const maior = valor !== "" && props.max !== undefined && n > Number(props.max);
      input.setCustomValidity(
        menor
          ? `Informe um valor a partir de ${formatarEntradaMoeda(props.min)}.`
          : maior
            ? `Informe um valor até ${formatarEntradaMoeda(props.max)}.`
            : "",
      );
    };
    return (
      <input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        data-currency="true"
        value={texto}
        onFocus={(e) => {
          foco.current = true;
          onFocus?.(eventoNumerico(e, canonico.current, restaurar));
        }}
        onChange={(e) => {
          const n = normalizarEntradaMoeda(e.target.value);
          if (n === null) return;
          setTexto(e.target.value);
          canonico.current = n;
          validar(e.currentTarget, n);
          onChange?.(eventoNumerico(e, n, restaurar));
        }}
        onBlur={(e) => {
          foco.current = false;
          const n = canonico.current;
          setTexto(formatarEntradaMoeda(n));
          validar(e.currentTarget, n);
          onBlur?.(eventoNumerico(e, n, restaurar));
        }}
      />
    );
  },
);
InputMoeda.displayName = "InputMoeda";
