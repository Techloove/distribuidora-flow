export type DatasPedidoConsulta = {
  data_original: string;
  data_comercial: string;
  data_aprovacao: string | null;
  data_base_previa: string;
};
function dataISO(valor: unknown): valor is string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(`${valor}T12:00:00Z`);
  return Number.isFinite(data.getTime()) && data.toISOString().slice(0, 10) === valor;
}
/** Resposta incompleta torna a prévia indisponível; nunca inventa vencimentos. */
export function lerDatasPedido(valor: unknown): DatasPedidoConsulta {
  const d = valor as Partial<DatasPedidoConsulta> | null;
  if (
    !d ||
    !dataISO(d.data_original) ||
    !dataISO(d.data_comercial) ||
    !dataISO(d.data_base_previa) ||
    !(d.data_aprovacao === null || dataISO(d.data_aprovacao))
  )
    throw new Error(
      "Não foi possível conferir as datas do pedido. Atualize a consulta antes de conferir os prazos.",
    );
  return d as DatasPedidoConsulta;
}
