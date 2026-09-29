import { useEffect, useState } from "react";

const KEY = "erp.centro";
const EVENT = "erp:centro";

export function getCentro(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setCentro(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* Storage unavailable. */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Filtro global de centro de custo (Todos | Centro A | Centro B). */
export function useCentro() {
  const [centro, setState] = useState("");

  useEffect(() => {
    setState(getCentro());
    const onChange = () => setState(getCentro());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return { centro, setCentro };
}

/** Aplica o filtro de centro a uma lista de registros com centro_id. */
export function filtrarCentro<T extends Record<string, unknown>>(rows: T[], centro: string): T[] {
  if (!centro) return rows;
  return rows.filter((r) => r["centro_id"] === centro);
}
