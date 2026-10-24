import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import {
  forecastHmlStatus,
  forecastHmlEnviar,
  forecastHmlConsultar,
} from "@/lib/forecast-homologacao.functions";
import { opcoesHomologacaoSchema } from "@/lib/forecast-emissao";
import { ForecastDocumentosHml } from "./forecast-documentos-hml";

export function ForecastEnvioHml({ nota, cadastroOk }: { nota: string; cadastroOk: boolean }) {
  const { session } = useSupabase(),
    qc = useQueryClient();
  const status = useServerFn(forecastHmlStatus),
    enviar = useServerFn(forecastHmlEnviar),
    consultar = useServerFn(forecastHmlConsultar);
  const [form, setForm] = useState({
    natureza_operacao: "",
    codigo_municipio_destinatario: "",
    modalidade_frete: "",
    consumidor_final: "",
    presenca_comprador: "",
    forma_pagamento: "",
  });
  const [confirmado, setConfirmado] = useState(false);
  const q = useQuery({
    queryKey: ["forecast-hml-status", nota, session?.user.id],
    enabled: !!session,
    retry: false,
    staleTime: 0,
    queryFn: () => status({ data: { nota, accessToken: session!.access_token } }),
  });
  const m = useMutation({
    mutationFn: async (acao: "enviar" | "consultar") => {
      const base = { nota, accessToken: session!.access_token };
      if (acao === "consultar") return consultar({ data: base });
      if (!confirmado)
        throw new Error("Confirme a revisão da operação antes do envio de homologação.");
      const parsed = opcoesHomologacaoSchema.safeParse(form);
      if (!parsed.success)
        throw new Error("Preencha todas as opções fiscais e o código IBGE de 7 dígitos.");
      return enviar({ data: { ...base, opcoes: parsed.data, confirmado: true } });
    },
    onSuccess: (r) => {
      setConfirmado(false);
      qc.setQueryData(["forecast-hml-status", nota, session?.user.id], r);
      toast.success("Acompanhamento de homologação atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ["forecast-hml-status", nota] }),
  });
  const alterar = (campo: keyof typeof form, valor: string) => {
    setForm((f) => ({ ...f, [campo]: valor }));
    setConfirmado(false);
  };
  return (
    <section className="space-y-3 rounded-lg border p-3 text-sm">
      <h3 className="font-semibold">Transmissão de teste · Homologação</h3>
      <p>
        O resultado fica separado da nota operacional e não libera carga, boleto ou estoque.
        Produção está bloqueada.
      </p>
      {q.error && (
        <p role="alert" className="text-destructive">
          {q.error.message}
        </p>
      )}
      {q.data && (
        <>
          {q.data.existe && (
            <div role="status" className="rounded bg-muted p-3 space-y-1">
              <p>Referência: {q.data.ref}</p>
              <p>Estado em homologação: {q.data.estado}</p>
              <p>{q.data.resultado?.mensagem}</p>
              {q.data.resultado?.chave && (
                <p className="break-all">Chave de homologação: {q.data.resultado.chave}</p>
              )}
              {q.data.resultado?.protocolo && (
                <p>Protocolo de homologação: {q.data.resultado.protocolo}</p>
              )}
            </div>
          )}
          {!q.data.envio_iniciado && (
            <>
              {!q.data.liberado_para_envio && (
                <p role="alert">
                  O administrador precisa habilitar a homologação nas configurações da loja para o
                  token e os dados fiscais atuais.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="hml-natureza">Natureza da operação</Label>
                  <Input
                    id="hml-natureza"
                    maxLength={60}
                    value={form.natureza_operacao}
                    disabled={m.isPending}
                    onChange={(e) => alterar("natureza_operacao", e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="hml-ibge">Código IBGE do município destinatário</Label>
                  <Input
                    id="hml-ibge"
                    maxLength={7}
                    inputMode="numeric"
                    value={form.codigo_municipio_destinatario}
                    disabled={m.isPending}
                    onChange={(e) => alterar("codigo_municipio_destinatario", e.target.value)}
                  />
                </div>
                {(
                  [
                    [
                      "modalidade_frete",
                      "Modalidade de frete",
                      [
                        ["0", "Contratação por conta do remetente"],
                        ["1", "Contratação por conta do destinatário"],
                        ["2", "Por conta de terceiros"],
                        ["3", "Transporte próprio do remetente"],
                        ["4", "Transporte próprio do destinatário"],
                        ["9", "Sem ocorrência de transporte"],
                      ],
                    ],
                    [
                      "consumidor_final",
                      "Consumidor final",
                      [
                        ["0", "Não"],
                        ["1", "Sim"],
                      ],
                    ],
                    [
                      "presenca_comprador",
                      "Presença do comprador",
                      [
                        ["1", "Presencial"],
                        ["4", "Entrega a domicílio"],
                      ],
                    ],
                    [
                      "forma_pagamento",
                      "Meio de pagamento desta nota",
                      [
                        ["01", "Dinheiro"],
                        ["02", "Cheque"],
                        ["15", "Boleto bancário"],
                        ["16", "Depósito bancário"],
                        ["17", "PIX"],
                        ["18", "Transferência bancária"],
                        ["90", "Sem pagamento"],
                      ],
                    ],
                  ] as const
                ).map(([campo, label, opcoes]) => (
                  <div key={campo}>
                    <Label htmlFor={`hml-${campo}`}>{label}</Label>
                    <select
                      id={`hml-${campo}`}
                      className="h-10 w-full rounded-md border bg-background px-2"
                      disabled={m.isPending}
                      value={form[campo]}
                      onChange={(e) => alterar(campo, e.target.value)}
                    >
                      <option value="">Selecione</option>
                      {opcoes.map(([v, t]) => (
                        <option key={v} value={v}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={confirmado}
                  disabled={m.isPending}
                  onChange={(e) => setConfirmado(e.target.checked)}
                />
                Conferi os dados desta operação com o contador e quero enviar uma NF-e de teste, sem
                valor fiscal, usando o token de homologação da loja.
              </label>
              <Button
                disabled={
                  !cadastroOk ||
                  !q.data.liberado_para_envio ||
                  !confirmado ||
                  m.isPending ||
                  q.isFetching
                }
                onClick={() => m.mutate("enviar")}
              >
                {m.isPending ? "Processando..." : "Enviar NF-e em homologação"}
              </Button>
            </>
          )}
          {q.data.envio_iniciado && (
            <>
              <p>
                Esta referência já teve uma tentativa. Em caso de demora, falha ou rejeição,
                consulte o resultado; o sistema não repetirá o envio.
              </p>
              <Button
                variant="outline"
                disabled={m.isPending || q.isFetching}
                onClick={() => m.mutate("consultar")}
              >
                Consultar retorno na Forecast
              </Button>
              <ForecastDocumentosHml key={nota} nota={nota} />
            </>
          )}
        </>
      )}
    </section>
  );
}
