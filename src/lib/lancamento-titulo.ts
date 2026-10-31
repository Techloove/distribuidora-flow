import { dataBr } from "./formatacao";
import { deslocarDataISO } from "./integridade-consultas";
export type CategoriaTitulo = {
  id: string;
  nome: string;
  parent_id: string | null;
  tipo: string;
  ativo: boolean;
};
/** Aceita reais brasileiros e decimal simples, sem eliminar texto inválido silenciosamente. */
export function valorTitulo(texto: string) {
  const s = texto
    .trim()
    .replace(/^R\$\s*/, "")
    .replace(/\s/g, "");
  if (!s) return NaN;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s))
    return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^\d+(?:[,.]\d{1,2})?$/.test(s)) return Number(s.replace(",", "."));
  return NaN;
}
export function subcategoriasTitulo(categorias: CategoriaTitulo[], raiz: string) {
  const resultado: { id: string; nome: string }[] = [],
    vistos = new Set([raiz]);
  function visitar(pai: string, caminho: string) {
    for (const c of categorias.filter((c) => c.parent_id === pai && c.ativo)) {
      if (vistos.has(c.id)) continue;
      vistos.add(c.id);
      const nome = caminho ? `${caminho} › ${c.nome}` : c.nome;
      resultado.push({ id: c.id, nome });
      visitar(c.id, nome);
    }
  }
  visitar(raiz, "");
  return resultado;
}
/** Replica o arredondamento positivo do RPC: a diferença fica na última parcela. */
export function previsaoTitulo(
  valor: number,
  parcelas: number,
  vencimento: string,
  intervalo: number,
) {
  if (
    !Number.isFinite(valor) ||
    valor <= 0 ||
    valor > 999999999999.99 ||
    !Number.isSafeInteger(parcelas) ||
    parcelas < 1 ||
    !Number.isSafeInteger(intervalo) ||
    intervalo < 0 ||
    (parcelas > 1 && intervalo < 1) ||
    dataBr(vencimento) === "—"
  )
    return null;
  const centavos = Math.round(valor * 100),
    base = Math.round(centavos / parcelas),
    ultima = centavos - base * (parcelas - 1);
  if (base <= 0 || ultima <= 0) return null;
  try {
    const fim = deslocarDataISO(vencimento, (parcelas - 1) * intervalo);
    if (!/^\d{4}-/.test(fim)) return null;
    return {
      parcelas,
      valor: centavos / 100,
      primeira: base / 100,
      ultima: ultima / 100,
      inicio: vencimento,
      fim,
    };
  } catch {
    return null;
  }
}
