import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { especiesSicoob, type EmissaoSicoob } from "@/lib/sicoob-emissao";

export function SicoobCondicoesEmissao({
  value: c,
  onChange,
  disabled,
}: {
  value: EmissaoSicoob;
  onChange: (c: EmissaoSicoob) => void;
  disabled: boolean;
}) {
  function selecionar(k: keyof EmissaoSicoob, label: string, op: [number | string, string][]) {
    return (
      <div className="space-y-1">
        <Label htmlFor={`sicoob-cond-${k}`}>{label}</Label>
        <select
          id={`sicoob-cond-${k}`}
          className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
          value={c[k]}
          onChange={(e) =>
            onChange({ ...c, [k]: k === "especie" ? e.target.value : Number(e.target.value) })
          }
        >
          {op.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </div>
    );
  }
  function numero(k: keyof EmissaoSicoob, label: string, moeda = false) {
    return (
      <div className="space-y-1">
        <Label htmlFor={`sicoob-cond-${k}`}>{label}</Label>
        <Input
          id={`sicoob-cond-${k}`}
          type={moeda ? "text" : "number"}
          currency={moeda}
          min="0"
          step={moeda ? undefined : "any"}
          value={c[k]}
          onChange={(e) =>
            onChange({ ...c, [k]: e.target.value === "" ? 0 : Number(e.target.value) })
          }
        />
      </div>
    );
  }
  return (
    <fieldset disabled={disabled} className="space-y-4 rounded-xl border p-4">
      <legend className="px-2 font-semibold">Condições padrão de novas emissões</legend>
      <p className="text-sm text-muted-foreground">
        Aplicadas aos próximos boletos desta loja. Não alteram boletos já registrados. Protesto,
        negativação e Pix dependem da habilitação no convênio.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {selecionar(
          "especie",
          "Espécie do documento",
          especiesSicoob.map((x) => [x, x === "DM" ? "DM · Duplicata mercantil" : x]),
        )}
        {selecionar("formulario", "Formato do PDF", [
          [1, "A4 · sem envelopamento"],
          [2, "A4 · três vias"],
          [3, "A4 · autoenvelopável"],
        ])}
        {selecionar("pix", "Pix no boleto", [
          [0, "Padrão do banco"],
          [1, "Com Pix"],
          [2, "Sem Pix"],
        ])}
        {numero("limiteDias", "Limite para pagamento após vencer (dias; 0 = não informar)")}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {selecionar("multaTipo", "Multa", [
          [0, "Isento"],
          [1, "Valor fixo"],
          [2, "Percentual"],
        ])}
        {c.multaTipo !== 0 && (
          <>
            {numero(
              "multaValor",
              c.multaTipo === 2 ? "Multa (%)" : "Multa (R$)",
              c.multaTipo === 1,
            )}
            {numero("multaDias", "Multa a partir de quantos dias após vencer")}
          </>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {selecionar("jurosTipo", "Juros", [
          [3, "Isento"],
          [1, "Valor por dia"],
          [2, "Taxa mensal"],
        ])}
        {c.jurosTipo !== 3 && (
          <>
            {numero(
              "jurosValor",
              c.jurosTipo === 2 ? "Taxa mensal (%)" : "Juros por dia (R$)",
              c.jurosTipo === 1,
            )}
            {numero("jurosDias", "Juros a partir de quantos dias após vencer")}
          </>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {selecionar("descontoTipo", "Desconto até a data limite", [
          [0, "Sem desconto"],
          [1, "Valor fixo"],
          [2, "Percentual"],
        ])}
        {c.descontoTipo !== 0 && (
          <>
            {numero(
              "descontoValor",
              c.descontoTipo === 2 ? "Desconto (%)" : "Desconto (R$)",
              c.descontoTipo === 1,
            )}
            {numero("descontoDias", "Prazo do desconto: dias antes do vencimento")}
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        O desconto padrão tem uma faixa de prazo. Descontos por antecipação diária não são
        configurados nesta tela.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {selecionar("protestoTipo", "Protesto automático", [
          [3, "Não protestar"],
          [1, "Protestar · dias corridos"],
          [2, "Protestar · dias úteis"],
        ])}
        {c.protestoTipo !== 3 && numero("protestoDias", "Prazo para protesto (1 a 99 dias)")}
        {selecionar("negativacaoTipo", "Negativação automática", [
          [3, "Não negativar"],
          [2, "Negativar · dias úteis"],
        ])}
        {c.negativacaoTipo !== 3 &&
          numero("negativacaoDias", "Prazo para negativação (1 a 99 dias úteis)")}
      </div>
      <div className="space-y-1">
        <Label htmlFor="sicoob-instrucoes">
          Instruções impressas (até 5 linhas de 40 caracteres)
        </Label>
        <textarea
          id="sicoob-instrucoes"
          rows={5}
          className="w-full rounded-xl border bg-background p-3 text-sm"
          value={c.instrucoes}
          onChange={(e) => onChange({ ...c, instrucoes: e.target.value })}
        />
      </div>
    </fieldset>
  );
}
