import { useSyncExternalStore } from "react";
export type ModalidadeFiltro = "todos" | "estoque" | "intermediacao";
const KEY = "erp.modalidade-venda";
const EVENT = "erp:modalidade-venda";
let memoria: ModalidadeFiltro = "todos";
export const nomesModalidade = {
  todos: "Todos",
  estoque: "Vendas Estoque",
  intermediacao: "Vendas Intermediação",
} as const;
export function normalizarModalidade(valor: unknown): ModalidadeFiltro {
  return valor === "estoque" || valor === "intermediacao" ? valor : "todos";
}
export function getModalidade(): ModalidadeFiltro {
  if (typeof window === "undefined") return "todos";
  try {
    return normalizarModalidade(window.localStorage.getItem(KEY));
  } catch {
    return memoria;
  }
}
export function setModalidade(valor: ModalidadeFiltro) {
  if (typeof window === "undefined") return;
  memoria = normalizarModalidade(valor);
  try {
    window.localStorage.setItem(KEY, normalizarModalidade(valor));
  } catch {
    /* Armazenamento bloqueado pelo navegador. */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}
const assinar = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
};
export function useModalidade() {
  const modalidade = useSyncExternalStore(assinar, getModalidade, () => "todos" as const);
  return { modalidade, setModalidade };
}
