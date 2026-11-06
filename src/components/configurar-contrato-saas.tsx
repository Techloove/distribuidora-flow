import { textoMensalidadePorSalario, primeiroVencimentoComCarencia } from "@/lib/reajuste-saas";
import { AvisoReajustesSaas } from "@/components/aviso-reajustes-saas";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { brl, dataBr } from "@/lib/formatacao";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { periodicidadesSaas, tiposServicoSaas, nomeServicoSaas } from "@/lib/faturas-saas";
import type { SaasPainel, SaasPreviaContrato } from "@/lib/saas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Servico = {
  carencia_inicial_dias: string;
  percentual_salario: string;
  reajustes: { vigencia: string; salario_minimo: string }[];
  id: string;
  descricao: string;
  tipo: string;
  periodicidade: string;
  valor: string;
  primeiro_vencimento: string;
  parcelas: number;
  observacao: string;
};
const seletor = "h-10 w-full rounded-xl border bg-background px-3 text-sm";
export function ConfigurarContratoSaas({
  painel,
  fechar,
  salvo,
}: {
  painel: SaasPainel;
  fechar: () => void;
  salvo: () => Promise<void>;
}) {
  const { client } = useSupabase();
  const c = painel.contrato!;
  const hoje = hojeSaoPaulo();
  const [form, setForm] = useState(() => ({
    empresa: c.empresa,
    responsavel: c.responsavel,
    contato: c.contato,
    plano: c.plano,
    dominio: c.dominio,
    master_id: c.master_id ?? "",
    master_ids: c.master_ids?.length ? c.master_ids : c.master_id ? [c.master_id] : [],
    inicio: c.inicio ?? hoje,
    fim: c.fim ?? "",
    tolerancia: c.tolerancia,
    aviso_dias: c.aviso_dias,
    controle_ativo: c.controle_ativo,
    instrucoes: c.instrucoes,
  }));
  const [servicos, setServicos] = useState<Servico[]>(() =>
    (painel.itens_contrato ?? []).map((s) => ({
      ...s,
      carencia_inicial_dias: s.carencia_inicial_dias == null ? "" : String(s.carencia_inicial_dias),
      valor: String(s.valor),
      percentual_salario: s.percentual_salario == null ? "" : String(s.percentual_salario),
      reajustes: (s.reajustes ?? []).map((r) => ({
        vigencia: r.vigencia,
        salario_minimo: r.salario_minimo == null ? "" : String(r.salario_minimo),
      })),
    })),
  );
  const [previa, setPrevia] = useState<SaasPreviaContrato | null>(null);
  const dados = () => ({
    ...form,
    master_id: form.master_ids[0] ?? "",
    servicos: servicos.map((s) => ({
      ...s,
      carencia_inicial_dias: s.carencia_inicial_dias.trim()
        ? Number(s.carencia_inicial_dias)
        : null,
      primeiro_vencimento: s.carencia_inicial_dias.trim()
        ? primeiroVencimentoComCarencia(form.inicio, Number(s.carencia_inicial_dias))
        : s.primeiro_vencimento,
      valor: Number(s.valor),
      percentual_salario: s.percentual_salario.trim() ? Number(s.percentual_salario) : null,
      reajustes: s.reajustes.map((r) => ({
        vigencia: r.vigencia,
        salario_minimo: r.salario_minimo.trim() ? Number(r.salario_minimo) : null,
      })),
    })),
  });
  const prever = useMutation({
    mutationFn: async () => {
      if (!form.master_ids.length)
        throw new Error("Selecione ao menos um administrador responsável pela mensalidade.");
      const r = await client!.rpc("saas_prever_contrato_335", { _dados: dados() });
      if (r.error) throw new Error(r.error.message);
      return r.data as SaasPreviaContrato;
    },
    onSuccess: setPrevia,
    onError: (e: Error) => toast.error(e.message),
  });
  const salvar = useMutation({
    mutationFn: async () => {
      const r = await client!.rpc("saas_salvar_grade_335", {
        _dados: dados(),
        _revisao: c.revisao,
      });
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: async () => {
      await salvo();
      fechar();
      toast.success("Contrato e serviços salvos. Faturas disponíveis em Minha mensalidade.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const ocupado = prever.isPending || salvar.isPending;
  const alterar = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setPrevia(null);
    setForm((f) => ({ ...f, [key]: value }));
  };
  const alterarServico = (id: string, patch: Partial<Servico>) => {
    setPrevia(null);
    setServicos((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };
  const adicionar = (tipo: string) => {
    setPrevia(null);
    setServicos((ss) => [
      ...ss,
      {
        id: crypto.randomUUID(),
        tipo,
        descricao: tiposServicoSaas[tipo] ?? "Serviço",
        periodicidade:
          tipo === "mensalidade"
            ? "mensal"
            : tipo === "implantacao"
              ? "parcelado"
              : tipo === "hospedagem" || tipo === "dominio"
                ? "anual"
                : "unica",
        valor: "0",
        carencia_inicial_dias: "",
        percentual_salario: "",
        reajustes: [],
        primeiro_vencimento: form.inicio,
        parcelas: 1,
        observacao: "",
      },
    ]);
  };
  const campo = (
    key: "empresa" | "responsavel" | "contato" | "plano" | "dominio" | "inicio" | "fim",
    label: string,
    type = "text",
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`contrato-${key}`}>{label}</Label>
      <Input
        id={`contrato-${key}`}
        value={form[key]}
        type={type}
        required={["empresa", "inicio", "fim"].includes(key)}
        onChange={(e) => alterar(key, e.target.value)}
      />
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !ocupado) fechar();
      }}
    >
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Contrato e serviços da empresa</DialogTitle>
          <DialogDescription>
            Defina a vigência e os serviços cobrados da operação atual. Revise todos os vencimentos
            antes de salvar.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (previa) salvar.mutate();
            else prever.mutate();
          }}
        >
          <fieldset disabled={ocupado} className="space-y-5">
            <section className="grid gap-4 rounded-xl border bg-muted/20 p-4 sm:grid-cols-3">
              {campo("empresa", "Empresa")}
              {campo("plano", "Plano")}
              {campo("dominio", "Domínio")}
              {campo("responsavel", "Responsável")}
              {campo("contato", "Contato para cobrança")}
              <fieldset className="space-y-2 sm:col-span-3">
                <legend className="text-sm font-medium">
                  Responsáveis pela mensalidade (usuários master)
                </legend>
                <p className="text-xs text-muted-foreground">
                  Selecione um ou mais administradores para receber os avisos e consultar as
                  faturas. Somente o proprietário da plataforma confirma pagamentos e configura o
                  contrato.
                </p>
                <div className="grid max-h-48 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2">
                  {painel.masters?.map((m) => (
                    <label key={m.id} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.master_ids.includes(m.id)}
                        disabled={!form.master_ids.includes(m.id) && form.master_ids.length >= 20}
                        onChange={(e) =>
                          alterar(
                            "master_ids",
                            e.target.checked
                              ? [...form.master_ids, m.id]
                              : form.master_ids.filter((id) => id !== m.id),
                          )
                        }
                      />
                      <span>
                        {m.nome || m.email}
                        <span className="block text-xs text-muted-foreground">{m.email}</span>
                      </span>
                    </label>
                  ))}
                  {form.master_ids
                    .filter((id) => !painel.masters?.some((m) => m.id === id))
                    .map((id, i) => (
                      <label key={id} className="flex items-start gap-2 text-sm text-amber-800">
                        <input
                          type="checkbox"
                          checked
                          onChange={() =>
                            alterar(
                              "master_ids",
                              form.master_ids.filter((v) => v !== id),
                            )
                          }
                        />
                        Responsável indisponível {i + 1}: remova da seleção e escolha um
                        administrador ativo.
                      </label>
                    ))}
                </div>
              </fieldset>
              {campo("inicio", "Início do contrato", "date")}
              {campo("fim", "Fim do contrato", "date")}
            </section>
            {!c.modelo_335 && !!painel.parcelas?.length && (
              <p className="rounded-xl border bg-muted p-3 text-sm">
                As cobranças anteriores serão preservadas. Para evitar duplicidade, os novos
                serviços devem começar após o último vencimento já lançado (
                {dataBr(painel.parcelas.at(-1)?.vencimento)}). A vigência deve incluir esses
                vencimentos anteriores.
              </p>
            )}
            <section className="space-y-3">
              <div>
                <h3 className="font-semibold">Serviços do contrato</h3>
                <p className="text-sm text-muted-foreground">
                  Valor por cobrança para mensal/anual; valor total para o parcelamento. Todos os
                  vencimentos precisam caber no contrato. O último dia do mês é ajustado
                  automaticamente.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(tiposServicoSaas).map(([tipo, label]) => (
                  <Button
                    key={tipo}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={servicos.length >= 50}
                    onClick={() => adicionar(tipo)}
                  >
                    + {label}
                  </Button>
                ))}
              </div>
              {!servicos.length && (
                <p className="rounded-xl border border-dashed p-5 text-sm">
                  Adicione a mensalidade, setup, hospedagem ou outros serviços cobrados desta
                  empresa.
                </p>
              )}
              {servicos.map((s, i) => (
                <div key={s.id} className="space-y-3 rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">
                      {i + 1}. {tiposServicoSaas[s.tipo]}
                    </h4>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPrevia(null);
                        setServicos((ss) => ss.filter((x) => x.id !== s.id));
                      }}
                    >
                      Remover serviço {i + 1}
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.3fr_1fr_1.3fr_0.7fr]">
                    <div>
                      <Label htmlFor={`servico-descricao-${s.id}`}>Descrição</Label>
                      <Input
                        id={`servico-descricao-${s.id}`}
                        required
                        minLength={2}
                        maxLength={160}
                        value={nomeServicoSaas(s.descricao)}
                        onChange={(e) => {
                          const original = painel.itens_contrato?.find(
                            (item) => item.id === s.id,
                          )?.descricao;
                          alterarServico(s.id, {
                            descricao:
                              original !== undefined && e.target.value === nomeServicoSaas(original)
                                ? original
                                : e.target.value,
                          });
                        }}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`servico-frequencia-${s.id}`}>Cobrança</Label>
                      <select
                        id={`servico-frequencia-${s.id}`}
                        className={seletor}
                        value={s.periodicidade}
                        onChange={(e) =>
                          alterarServico(s.id, {
                            periodicidade: e.target.value,
                            parcelas: 1,
                            ...(e.target.value !== "mensal"
                              ? { percentual_salario: "", reajustes: [], carencia_inicial_dias: "" }
                              : {}),
                          })
                        }
                      >
                        {Object.entries(periodicidadesSaas).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor={`servico-valor-${s.id}`}>
                        {s.periodicidade === "parcelado"
                          ? "Valor total (R$)"
                          : s.percentual_salario || s.reajustes.length
                            ? "Valor inicial (R$)"
                            : "Valor (R$)"}
                      </Label>
                      <Input
                        id={`servico-valor-${s.id}`}
                        currency
                        required
                        value={s.valor}
                        onChange={(e) => alterarServico(s.id, { valor: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`servico-data-${s.id}`}>Primeiro vencimento</Label>
                      <Input
                        id={`servico-data-${s.id}`}
                        type="date"
                        min={form.inicio}
                        max={form.fim}
                        required
                        value={
                          s.carencia_inicial_dias.trim()
                            ? primeiroVencimentoComCarencia(
                                form.inicio,
                                Number(s.carencia_inicial_dias),
                              )
                            : s.primeiro_vencimento
                        }
                        readOnly={s.carencia_inicial_dias !== ""}
                        onChange={(e) =>
                          alterarServico(s.id, { primeiro_vencimento: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`servico-parcelas-${s.id}`}>Parcelas</Label>
                      <Input
                        id={`servico-parcelas-${s.id}`}
                        type="number"
                        required
                        min={1}
                        max={120}
                        disabled={s.periodicidade !== "parcelado"}
                        value={s.parcelas}
                        onChange={(e) => alterarServico(s.id, { parcelas: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                  {s.tipo === "mensalidade" && s.periodicidade === "mensal" && (
                    <section className="space-y-3 rounded-xl border bg-muted/30 p-3">
                      <h4 className="text-sm font-medium">Mensalidade pré-paga</h4>
                      <p className="text-xs text-muted-foreground">
                        Cada vencimento inicia o próximo período de uso pago. A carência inicial é
                        gratuita e vale apenas no início do contrato. Setup e demais serviços seguem
                        seus próprios vencimentos.
                      </p>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={s.carencia_inicial_dias !== ""}
                          onChange={(e) =>
                            alterarServico(
                              s.id,
                              e.target.checked
                                ? { carencia_inicial_dias: "30" }
                                : {
                                    carencia_inicial_dias: "",
                                    primeiro_vencimento:
                                      primeiroVencimentoComCarencia(
                                        form.inicio,
                                        Number(s.carencia_inicial_dias),
                                      ) || s.primeiro_vencimento,
                                  },
                            )
                          }
                        />
                        Definir carência inicial gratuita
                      </label>
                      {s.carencia_inicial_dias !== "" && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <Label htmlFor={`servico-carencia-${s.id}`}>
                              Dias gratuitos no início
                            </Label>
                            <Input
                              id={`servico-carencia-${s.id}`}
                              type="number"
                              min={0}
                              max={365}
                              step={1}
                              required
                              value={s.carencia_inicial_dias.trim()}
                              onChange={(e) =>
                                alterarServico(s.id, {
                                  carencia_inicial_dias: e.target.value || " ",
                                })
                              }
                            />
                          </div>
                          <p className="self-end pb-2 text-sm">
                            Primeiro vencimento:{" "}
                            {dataBr(
                              primeiroVencimentoComCarencia(
                                form.inicio,
                                Number(s.carencia_inicial_dias),
                              ),
                            )}
                          </p>
                        </div>
                      )}
                    </section>
                  )}
                  {s.tipo === "mensalidade" && s.periodicidade === "mensal" && (
                    <section className="space-y-3 rounded-xl border bg-muted/30 p-3">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          checked={!!s.percentual_salario || s.reajustes.length > 0}
                          onChange={(e) =>
                            alterarServico(
                              s.id,
                              e.target.checked
                                ? {
                                    percentual_salario: "23",
                                    reajustes: s.reajustes.length
                                      ? s.reajustes
                                      : [
                                          {
                                            vigencia: `${Math.max(Number(form.inicio.slice(0, 4)), Number(hoje.slice(0, 4))) + 1}-01-01`,
                                            salario_minimo: "",
                                          },
                                        ],
                                  }
                                : { percentual_salario: "", reajustes: [] },
                            )
                          }
                        />
                        Reajustar mensalidade por percentual do salário mínimo
                      </label>
                      {(!!s.percentual_salario || s.reajustes.length > 0) && (
                        <>
                          <div className="max-w-xs space-y-1">
                            <Label htmlFor={`servico-percentual-${s.id}`}>
                              Percentual do salário mínimo (%)
                            </Label>
                            <Input
                              id={`servico-percentual-${s.id}`}
                              type="number"
                              min="0.0001"
                              max="100"
                              step="0.0001"
                              required
                              value={s.percentual_salario}
                              onChange={(e) =>
                                alterarServico(s.id, { percentual_salario: e.target.value })
                              }
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            O valor atual vale até o primeiro reajuste. Informe a vigência e o
                            salário mínimo de referência; a mensalidade será calculada pelo
                            percentual acima. Deixe a referência vazia se ainda estiver a definir: a
                            partir dessa vigência, as mensalidades aguardam definição antes de gerar
                            cobrança. O setup e os outros serviços não mudam.
                          </p>
                          {s.reajustes.map((r, j) => (
                            <div
                              key={j}
                              className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
                            >
                              <div>
                                <Label htmlFor={`reajuste-data-${s.id}-${j}`}>
                                  Vigência do reajuste
                                </Label>
                                <Input
                                  id={`reajuste-data-${s.id}-${j}`}
                                  type="date"
                                  min={form.inicio}
                                  max={form.fim || undefined}
                                  required
                                  value={r.vigencia}
                                  onChange={(e) =>
                                    alterarServico(s.id, {
                                      reajustes: s.reajustes.map((x, k) =>
                                        k === j ? { ...x, vigencia: e.target.value } : x,
                                      ),
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <Label htmlFor={`reajuste-base-${s.id}-${j}`}>
                                  Salário mínimo (R$)
                                </Label>
                                <Input
                                  id={`reajuste-base-${s.id}-${j}`}
                                  currency
                                  placeholder="A definir"
                                  value={r.salario_minimo}
                                  onChange={(e) =>
                                    alterarServico(s.id, {
                                      reajustes: s.reajustes.map((x, k) =>
                                        k === j ? { ...x, salario_minimo: e.target.value } : x,
                                      ),
                                    })
                                  }
                                />
                              </div>
                              <div className="py-2 text-sm">
                                <span className="block text-xs text-muted-foreground">
                                  Mensalidade reajustada
                                </span>
                                {r.salario_minimo.trim()
                                  ? textoMensalidadePorSalario(
                                      r.salario_minimo,
                                      s.percentual_salario,
                                    )
                                  : "A definir"}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() =>
                                  alterarServico(s.id, {
                                    reajustes: s.reajustes.filter((_, k) => k !== j),
                                  })
                                }
                              >
                                Remover reajuste
                              </Button>
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="outline"
                            disabled={s.reajustes.length >= 20}
                            onClick={() =>
                              alterarServico(s.id, {
                                reajustes: [...s.reajustes, { vigencia: "", salario_minimo: "" }],
                              })
                            }
                          >
                            Adicionar reajuste
                          </Button>
                        </>
                      )}
                    </section>
                  )}
                  <div>
                    <Label htmlFor={`servico-observacao-${s.id}`}>Observação (opcional)</Label>
                    <Input
                      id={`servico-observacao-${s.id}`}
                      maxLength={1000}
                      value={s.observacao}
                      onChange={(e) => alterarServico(s.id, { observacao: e.target.value })}
                    />
                  </div>
                </div>
              ))}
            </section>
            <section className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="contrato-tolerancia">Dias de tolerância após vencer</Label>
                <Input
                  id="contrato-tolerancia"
                  type="number"
                  min={0}
                  max={90}
                  required
                  value={form.tolerancia}
                  onChange={(e) => alterar("tolerancia", Number(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="contrato-aviso">Avisar quantos dias antes</Label>
                <Input
                  id="contrato-aviso"
                  type="number"
                  min={0}
                  max={60}
                  required
                  value={form.aviso_dias}
                  onChange={(e) => alterar("aviso_dias", Number(e.target.value))}
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="contrato-instrucoes">
                  Instruções para pagamento e regularização
                </Label>
                <Textarea
                  id="contrato-instrucoes"
                  maxLength={4000}
                  value={form.instrucoes}
                  onChange={(e) => alterar("instrucoes", e.target.value)}
                />
              </div>
              <label className="flex gap-3 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.controle_ativo}
                  onChange={(e) => alterar("controle_ativo", e.target.checked)}
                />
                Ativar avisos e bloqueio após a tolerância. Desmarcado, o ERP continua liberado.
              </label>
            </section>
          </fieldset>
          {(prever.error || salvar.error) && (
            <p role="alert" className="text-sm text-destructive">
              {(prever.error || salvar.error)?.message}
            </p>
          )}
          {previa && (
            <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <h3 className="font-semibold">
                Prévia do contrato: {previa.parcelas.length} cobrança(s) · {brl(previa.total)}
              </h3>
              <p className="text-sm">
                Serviços com o mesmo vencimento compõem uma única fatura. Confira as datas e o total
                do período. Se ativar o controle com vencimentos antigos, poderá haver bloqueio
                imediato por inadimplência.
              </p>
              <AvisoReajustesSaas reajustes={previa.reajustes_pendentes} />
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th>Serviço</th>
                      <th>Parcela</th>
                      <th>Vencimento</th>
                      <th className="text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.parcelas.map((p) => (
                      <tr key={p.chave} className="border-t">
                        <td className="py-2">{nomeServicoSaas(p.descricao)}</td>
                        <td>{p.parcela}</td>
                        <td>{dataBr(p.vencimento)}</td>
                        <td className="text-right">{brl(p.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" disabled={ocupado} onClick={fechar}>
              Cancelar
            </Button>
            <Button disabled={ocupado || !servicos.length}>
              {ocupado
                ? "Aguarde…"
                : previa
                  ? "Confirmar e salvar contrato"
                  : "Revisar serviços e faturas"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
