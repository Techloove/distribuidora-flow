import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { brl } from "@/lib/formatacao";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Row = Record<string, unknown>;
function valorInformado(value: unknown) {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "")
    return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function LiquidacaoSicredi({ boleto }: { boleto: Row }) {
  const { client, user } = useSupabase();
  const permissoes = usePermissoesRotinas();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [valor, setValor] = useState("");
  const [data, setData] = useState("");
  const [categoria, setCategoria] = useState("");
  const [referencia, setReferencia] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const pode = permissoes.pode("boletos_tarifa_registrar");
  const q = useQuery({
    queryKey: ["sicredi-tarifa", user?.id, boleto["id"]],
    enabled: !!client && open,
    queryFn: async () => {
      const { data, error } = await client!
        .from("sicredi_tarifas_279")
        .select("valor,data_cobranca,referencia,movimento_id,movimentos_financeiros(status)")
        .eq("boleto_id", String(boleto["id"]))
        .maybeSingle();
      if (error)
        throw new Error(
          "Não foi possível conferir a tarifa. Confira o acesso e a implantação da fase279.",
        );
      return data as Row | null;
    },
  });
  const categorias = useQuery({
    queryKey: ["categorias_financeiras", "tarifa-sicredi", user?.id],
    enabled: !!client && open && pode,
    queryFn: async () => {
      const { data, error } = await client!
        .from("categorias_financeiras")
        .select("id,nome")
        .eq("tipo", "despesa")
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const salvar = useMutation({
    mutationFn: async () => {
      if (
        !client ||
        !pode ||
        !confirmado ||
        !valor.trim() ||
        !Number.isFinite(Number(valor)) ||
        Number(valor) <= 0 ||
        !categoria ||
        !data ||
        referencia.trim().length < 3
      )
        throw new Error(
          "Informe o valor do extrato, data, categoria e referência e confirme a conferência.",
        );
      const { error } = await client.rpc("registrar_tarifa_sicredi_279", {
        _boleto: String(boleto["id"]),
        _valor: Number(valor),
        _data: data,
        _categoria: categoria,
        _referencia: referencia.trim(),
        _confirmado: confirmado,
      });
      if (error) throw new Error(error.message);
      await Promise.all(
        [
          "sicredi-tarifa",
          "vw_extrato_conta",
          "vw_conta_saldo",
          "vw_fluxo_caixa",
          "vw_dre_base",
        ].map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
    },
    onSuccess: () => {
      toast.success("Tarifa registrada como despesa bancária, sem alterar o recebimento.");
      setConfirmado(false);
      setValor("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const raw = boleto["sicredi_liquidacao_api"];
  const liquidacao = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Row) : {};
  const recebido = valorInformado(liquidacao["valor"]) ?? valorInformado(boleto["valor_liquidado"]);
  const movimento = q.data?.["movimentos_financeiros"] as { status?: string } | null;
  const tarifaAtiva = q.data && movimento?.status === "ativo" ? Number(q.data["valor"]) : null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Liquidação e tarifa
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!salvar.isPending) setOpen(v);
        }}
      >
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Liquidação Sicredi · {String(boleto["nosso_numero"] ?? "")}</DialogTitle>
            <DialogDescription>
              Valores do retorno bancário e tarifa conferida no extrato. A tarifa é despesa da loja.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Valor do boleto na emissão", boleto["valor"]],
              ["Juros retornados", liquidacao["juros"]],
              ["Multa retornada", liquidacao["multa"]],
              ["Desconto", liquidacao["desconto"]],
              ["Abatimento", liquidacao["abatimento"]],
              ["Total recebido", recebido],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{String(label)}</p>
                <strong>{valorInformado(value) === null ? "Não informado" : brl(value)}</strong>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Juros e multa são os acréscimos retornados pelo banco sobre o valor do boleto. Não são
            calculados novamente nesta tela. A API não tem campo de tarifa confirmado nesta
            implantação.
          </p>
          {q.isPending ? (
            <p>Conferindo tarifa registrada…</p>
          ) : q.error ? (
            <p role="alert">{q.error.message}</p>
          ) : q.data ? (
            <div className="space-y-2 rounded-lg border p-4 text-sm">
              <p>
                Tarifa vinculada: <strong>{brl(q.data["valor"])}</strong> ·{" "}
                {String(q.data["data_cobranca"])}
              </p>
              <p>Referência: {String(q.data["referencia"])}</p>
              <p>
                Movimento:{" "}
                {movimento?.status === "estornado"
                  ? "Estornado — conferir reconciliação no financeiro"
                  : movimento?.status === "ativo"
                    ? "Ativo"
                    : "Conferir no financeiro"}
              </p>
              {recebido !== null && tarifaAtiva !== null && (
                <p>
                  Líquido após esta tarifa (cálculo): <strong>{brl(recebido - tarifaAtiva)}</strong>
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm">
                Sem tarifa vinculada por esta rotina. Confira se ela já foi lançada em outro
                movimento financeiro.
              </p>
              {pode && (
                <fieldset className="space-y-3 rounded-lg border p-4" disabled={salvar.isPending}>
                  <legend className="px-1 text-sm font-semibold">
                    Registrar tarifa de cobrança comprovada no extrato
                  </legend>
                  <p className="text-xs text-muted-foreground">
                    A saída será na mesma conta e loja do recebimento. Não preencha um valor
                    estimado.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="tarifa-valor">Tarifa cobrada (R$)</Label>
                      <Input
                        id="tarifa-valor"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={valor}
                        onChange={(e) => setValor(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="tarifa-data">Data do débito</Label>
                      <Input
                        id="tarifa-data"
                        type="date"
                        max={hojeSaoPaulo()}
                        value={data}
                        onChange={(e) => setData(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tarifa-categoria">Categoria da despesa bancária</Label>
                    <select
                      id="tarifa-categoria"
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={categoria}
                      disabled={categorias.isPending || categorias.isError || salvar.isPending}
                      onChange={(e) => setCategoria(e.target.value)}
                    >
                      <option value="">Selecione</option>
                      {categorias.data?.map((c) => (
                        <option key={String(c.id)} value={String(c.id)}>
                          {String(c.nome)}
                        </option>
                      ))}
                    </select>
                    {categorias.error && (
                      <p role="alert">Não foi possível carregar as categorias.</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tarifa-referencia">Identificação da tarifa no extrato</Label>
                    <Input
                      id="tarifa-referencia"
                      maxLength={160}
                      value={referencia}
                      onChange={(e) => setReferencia(e.target.value)}
                    />
                  </div>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmado}
                      onChange={(e) => setConfirmado(e.target.checked)}
                    />
                    <span>
                      Conferi o débito no extrato e confirmei que esta tarifa ainda não foi lançada
                      no sistema.
                    </span>
                  </label>
                  <Button
                    disabled={
                      !confirmado ||
                      !valor ||
                      !categoria ||
                      !data ||
                      referencia.trim().length < 3 ||
                      salvar.isPending
                    }
                    onClick={() => salvar.mutate()}
                  >
                    {salvar.isPending ? "Registrando…" : "Registrar despesa da tarifa"}
                  </Button>
                </fieldset>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
