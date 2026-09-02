import { useEffect, useState } from "react";

const KEY = "erp.centro";
const EVENT = "erp:centro";

export function getCentro(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY) ?? "";
}

export function setCentro(id: string) {
  window.localStorage.setItem(KEY, id);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Filtro global de centro de custo (Todos | Centro A | Centro B). */
export function useCentro() {
  const [centro, setState] = useState("");

  useEffect(() => {
    setState(getCentro());
    const onChange = () => setState(getCentro());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  return { centro, setCentro };
}

/** Aplica o filtro de centro a uma lista de registros com centro_id. */
export function filtrarCentro<T extends Record<string, unknown>>(rows: T[], centro: string): T[] {
  if (!centro) return rows;
  return rows.filter((r) => r["centro_id"] === centro);
}
