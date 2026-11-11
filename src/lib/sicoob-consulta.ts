import { periodoRecuperacaoSicoob } from "./sicoob-api";
import { erroOperacaoSicoob } from "./sicoob-erros";

type Consulta = (path: string) => Promise<{
  status: number;
  json: Record<string, unknown>;
  motivo?: string | null;
}>;

/** Somente GET. Não entrega resultados parciais se alguma janela falhar. */
export async function consultarPagadorSicoob(
  api: Consulta,
  numeroCliente: number,
  documento: string,
  vencimento: unknown,
): Promise<unknown[]> {
  const registros: unknown[] = [];
  for (const periodo of periodoRecuperacaoSicoob(vencimento)) {
    const q = new URLSearchParams({
      numeroCliente: String(numeroCliente),
      numeroCpfCnpj: documento,
      ...periodo,
    });
    const r = await api(`/pagadores/${encodeURIComponent(documento)}/boletos?` + q);
    if (r.status === 204) continue;
    if (r.status !== 200) throw Error(erroOperacaoSicoob("Consulta", r.status, r.motivo));
    if (!Array.isArray(r.json["resultado"]))
      throw Error(
        "Emissão ainda não recuperada no banco. Não emita novamente antes da conferência.",
      );
    registros.push(...r.json["resultado"]);
  }
  return registros;
}
