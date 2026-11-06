import { nomeServicoSaas } from "@/lib/faturas-saas";
import { dataBr } from "@/lib/formatacao";
import type { SaasReajustePendente } from "@/lib/saas";
export function AvisoReajustesSaas({
  reajustes,
}: {
  reajustes?: SaasReajustePendente[] | undefined;
}) {
  if (!reajustes?.length) return null;
  return (
    <section
      role="status"
      className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <h3 className="font-semibold">Reajuste aguardando definição do salário mínimo</h3>
      {reajustes.map((r) => (
        <p key={`${r.servico_id}:${r.vigencia}`}>
          {nomeServicoSaas(r.descricao)}: {Number(r.percentual).toLocaleString("pt-BR")}% do salário
          mínimo, a partir de {dataBr(r.vigencia)}.
        </p>
      ))}
      <p>
        As mensalidades a partir dessa vigência ainda não estão incluídas nas cobranças e nos
        totais. O proprietário deve informar o salário mínimo e salvar a revisão do contrato para
        gerá-las. Os demais serviços seguem seus próprios vencimentos.
      </p>
    </section>
  );
}
