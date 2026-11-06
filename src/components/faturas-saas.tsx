import { AvisoReajustesSaas } from "@/components/aviso-reajustes-saas";
import { useState } from "react";
import { toast } from "sonner";
import { brl, dataBr, mesBr } from "@/lib/formatacao";
import {
  agruparFaturasSaas,
  nomeEstadoFatura,
  nomeServicoSaas,
  type FaturaSaas,
} from "@/lib/faturas-saas";
import type { SaasContrato, SaasParcela, SaasReajustePendente } from "@/lib/saas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

function imprimir(fatura: FaturaSaas, contrato: SaasContrato, reajustes: SaasReajustePendente[]) {
  const janela = window.open("", "_blank", "width=920,height=760");
  if (!janela) {
    toast.error("Permita abrir a janela de impressão para salvar a fatura em PDF.");
    return;
  }
  janela.opener = null;
  const d = janela.document;
  d.title = `${fatura.id} — ${contrato.empresa}`;
  const estilo = d.createElement("style");
  estilo.textContent =
    "body{font:14px Arial,sans-serif;color:#172b3a;margin:32px}h1{font-size:24px}p{line-height:1.6;white-space:pre-wrap}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;border-bottom:1px solid #ccd6df;padding:10px}td:last-child,th:last-child{text-align:right}@page{size:A4;margin:16mm}";
  d.head.append(estilo);
  const texto = (tag: string, valor: string, pai: HTMLElement = d.body) => {
    const el = d.createElement(tag);
    el.textContent = valor;
    pai.append(el);
    return el;
  };
  texto("h1", `Fatura de serviços · ${fatura.id}`);
  texto("h2", contrato.empresa);
  texto(
    "p",
    `${contrato.plano} · ${contrato.dominio}\nResponsável: ${contrato.responsavel || "Não informado"}\nContrato: ${dataBr(contrato.inicio)} a ${dataBr(contrato.fim)}\nCompetência: ${mesBr(fatura.competencia)} · Vencimentos: ${dataBr(fatura.vencimento)}${fatura.vencimento_final !== fatura.vencimento ? ` a ${dataBr(fatura.vencimento_final)}` : ""} · ${nomeEstadoFatura[fatura.estado]}`,
  );
  const tabela = d.createElement("table");
  d.body.append(tabela);
  const cabecalho = texto("tr", "", tabela);
  for (const valor of ["Serviço", "Parcela", "Vencimento", "Pagamento", "Situação", "Valor"])
    texto("th", valor, cabecalho);
  for (const item of fatura.itens) {
    const linha = texto("tr", "", tabela);
    for (const valor of [
      nomeServicoSaas(item.descricao) +
        (item.periodo_inicio && item.periodo_fim
          ? ` · pré-pago: uso de ${dataBr(item.periodo_inicio)} a ${dataBr(item.periodo_fim)}`
          : ""),
      String(item.parcela),
      dataBr(item.vencimento),
      dataBr(item.pagamento_data),
      item.estado === "pago"
        ? "Pago"
        : item.estado === "cancelado"
          ? "Cancelado"
          : item.estado === "vencido"
            ? "Vencido"
            : "Pendente",
      brl(item.valor),
    ])
      texto("td", valor, linha);
  }
  texto(
    "p",
    `Total a cobrar: ${brl(fatura.total)}\nPagamentos confirmados: ${brl(fatura.pago)}\nSaldo: ${brl(fatura.saldo)}`,
  );
  for (const reajuste of reajustes.filter(
    (r) => r.vigencia.slice(0, 7) <= fatura.competencia.slice(0, 7),
  )) {
    texto(
      "p",
      `${nomeServicoSaas(reajuste.descricao)}: salário mínimo a definir a partir de ${dataBr(reajuste.vigencia)}. A mensalidade de ${Number(reajuste.percentual).toLocaleString("pt-BR")}% da referência ainda não está incluída no total desta fatura.`,
    );
  }
  if (contrato.instrucoes) texto("p", contrato.instrucoes);
  texto(
    "p",
    "Pagamentos confirmados manualmente pelo proprietário da plataforma. Itens cancelados não compõem o total a cobrar.",
  );
  janela.focus();
  janela.print();
}
export function FaturasSaas({
  parcelas,
  contrato,
  reajustes = [],
  onPagar,
  onOperacaoItem,
  onEditarServico,
  servicosEditaveis = [],
  ocupado = false,
}: {
  parcelas: SaasParcela[];
  contrato: SaasContrato;
  reajustes?: SaasReajustePendente[] | undefined;
  onPagar?: ((fatura: FaturaSaas) => void) | undefined;
  onOperacaoItem?: ((parcela: SaasParcela, acao: "cancelado" | "reaberto") => void) | undefined;
  onEditarServico?: ((parcela: SaasParcela) => void) | undefined;
  servicosEditaveis?: string[];
  ocupado?: boolean;
}) {
  const [mes, setMes] = useState("");
  const [id, setId] = useState<string | null>(null);
  const faturas = agruparFaturasSaas(parcelas);
  const aberta = faturas.find((f) => f.id === id);
  const lista = faturas.filter((f) => !mes || f.competencia.startsWith(mes));
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-semibold">Faturas mensais</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada fatura reúne todos os serviços da mesma competência. O pagamento confirma o saldo
            pendente do mês inteiro; os vencimentos originais ficam no detalhamento.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="fatura-mes">Mês de competência</Label>
            <Input
              id="fatura-mes"
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={() => setMes("")}>
            Todo o período
          </Button>
        </div>
      </div>
      {lista.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-3">Competência / fatura</th>
                <th>Vencimentos</th>
                <th>Serviços</th>
                <th className="text-right">Total</th>
                <th className="text-right">Saldo</th>
                <th className="px-3">Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-3 font-medium">
                    {mesBr(f.competencia)}
                    <span className="block text-xs text-muted-foreground">{f.id}</span>
                  </td>
                  <td>
                    {dataBr(f.vencimento)}
                    {f.vencimento_final !== f.vencimento && (
                      <span className="block text-xs text-muted-foreground">
                        até {dataBr(f.vencimento_final)}
                      </span>
                    )}
                  </td>
                  <td>{f.itens.length}</td>
                  <td className="text-right">{brl(f.total)}</td>
                  <td className="text-right">{brl(f.saldo)}</td>
                  <td className="px-3">{nomeEstadoFatura[f.estado]}</td>
                  <td className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setId(f.id)}>
                        Ver fatura
                      </Button>
                      {onPagar && f.saldo > 0 && (
                        <Button size="sm" disabled={ocupado} onClick={() => onPagar(f)}>
                          Confirmar pagamento
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhuma fatura neste período. Configure os serviços do contrato para gerar os vencimentos.
        </p>
      )}
      <Dialog
        open={!!aberta}
        onOpenChange={(o) => {
          if (!o) setId(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Fatura mensal · {aberta && mesBr(aberta.competencia)}</DialogTitle>
            <DialogDescription>
              {contrato.empresa} · {contrato.plano}
            </DialogDescription>
          </DialogHeader>
          {aberta && (
            <div className="space-y-4">
              <div className="flex flex-wrap justify-between gap-3 rounded-xl border bg-muted/30 p-4">
                <p>
                  Vencimento: <strong>{dataBr(aberta.vencimento)}</strong>
                </p>
                <p>{nomeEstadoFatura[aberta.estado]}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2">Serviço</th>
                      <th>Parcela</th>
                      <th>Vencimento</th>
                      <th>Pagamento</th>
                      <th className="text-right">Valor</th>
                      {onOperacaoItem && <th>Ações</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {aberta.itens.map((p) => (
                      <tr key={p.chave} className="border-b">
                        <td className="py-3">
                          {nomeServicoSaas(p.descricao)}
                          {p.periodo_inicio && p.periodo_fim && (
                            <span className="block text-xs text-muted-foreground">
                              Pré-pago · uso de {dataBr(p.periodo_inicio)} a {dataBr(p.periodo_fim)}
                            </span>
                          )}
                          <span className="block text-xs text-muted-foreground">
                            {p.estado === "cancelado"
                              ? "Cancelado · fora do total"
                              : p.estado === "pago"
                                ? "Pago"
                                : p.estado === "vencido"
                                  ? "Vencido"
                                  : "Pendente"}
                          </span>
                        </td>
                        <td>{p.parcela}</td>
                        <td>{dataBr(p.vencimento)}</td>
                        <td>{dataBr(p.pagamento_data)}</td>
                        <td className="text-right">{brl(p.valor)}</td>
                        {onOperacaoItem && (
                          <td>
                            <div className="flex flex-wrap gap-2">
                              {onEditarServico && servicosEditaveis.includes(p.chave) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setId(null);
                                    onEditarServico(p);
                                  }}
                                >
                                  Editar serviço
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={ocupado}
                                onClick={() => {
                                  setId(null);
                                  onOperacaoItem(
                                    p,
                                    p.estado === "pago" || p.estado === "cancelado"
                                      ? "reaberto"
                                      : "cancelado",
                                  );
                                }}
                              >
                                {p.estado === "pago" || p.estado === "cancelado"
                                  ? "Reabrir cobrança"
                                  : "Cancelar cobrança"}
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 rounded-xl bg-muted/30 p-4 sm:grid-cols-3">
                <p>
                  Total<strong className="block">{brl(aberta.total)}</strong>
                </p>
                <p>
                  Pago<strong className="block">{brl(aberta.pago)}</strong>
                </p>
                <p>
                  Saldo<strong className="block">{brl(aberta.saldo)}</strong>
                </p>
              </div>
              <AvisoReajustesSaas
                reajustes={reajustes.filter(
                  (r) => r.vigencia.slice(0, 7) <= aberta.competencia.slice(0, 7),
                )}
              />
              {contrato.instrucoes && (
                <p className="whitespace-pre-wrap text-sm">{contrato.instrucoes}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Consulte os vencimentos e siga as instruções de pagamento do contrato. A confirmação
                do recebimento é feita pelo proprietário da plataforma.
              </p>
              <div className="flex flex-wrap justify-end gap-3">
                <Button variant="outline" onClick={() => setId(null)}>
                  Fechar
                </Button>
                {onPagar && aberta.saldo > 0 && (
                  <Button
                    disabled={ocupado}
                    onClick={() => {
                      setId(null);
                      onPagar(aberta);
                    }}
                  >
                    Confirmar pagamento
                  </Button>
                )}
                <Button onClick={() => imprimir(aberta, contrato, reajustes)}>
                  Imprimir / salvar PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
