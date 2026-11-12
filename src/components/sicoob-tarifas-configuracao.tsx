import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import {
  sicoobTarifasConfig,
  sicoobTarifasSalvar,
  sicoobTarifasSincronizar,
} from "@/lib/sicoob.functions";
import { dataHoraBr } from "@/lib/formatacao";
export function SicoobTarifasConfiguracao({ centroId }: { centroId: string }) {
  const { session } = useSupabase(),
    qc = useQueryClient();
  const get = useServerFn(sicoobTarifasConfig),
    save = useServerFn(sicoobTarifasSalvar),
    sync = useServerFn(sicoobTarifasSincronizar);
  const q = useQuery({
    queryKey: ["sicoob-tarifas", session?.user.id, centroId],
    enabled: !!session,
    refetchOnWindowFocus: false,
    queryFn: () => get({ data: { centroId, accessToken: session!.access_token } }),
  });
  const [categoria, setCategoria] = useState(""),
    [inicio, setInicio] = useState(""),
    [ativo, setAtivo] = useState(false),
    [busy, setBusy] = useState(false),
    [erro, setErro] = useState("");
  useEffect(() => {
    if (q.data) {
      setCategoria(q.data.categoriaId ?? "");
      setInicio(q.data.inicio);
      setAtivo(q.data.ativo);
      setErro("");
    }
  }, [q.data]);
  const dirty =
    categoria !== (q.data?.categoriaId ?? "") ||
    inicio !== q.data?.inicio ||
    ativo !== q.data?.ativo;
  async function executar(acao: "salvar" | "consultar") {
    if (!session || busy) return;
    setBusy(true);
    setErro("");
    try {
      if (acao === "salvar") {
        const r = await save({
          data: {
            centroId,
            accessToken: session.access_token,
            categoriaId: categoria,
            inicio,
            ativo,
            versao: q.data?.versao ?? 0,
          },
        });
        toast.success(r.mensagem);
      } else {
        const r = await sync({ data: { centroId, accessToken: session.access_token } });
        toast.success(
          `Tarifas: ${r.lancados} lançada(s). Sem vínculo ou fora das regras: ${r.ignorados}. Para conferir: ${r.conferir}.`,
        );
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sicoob-tarifas"] }),
        qc.invalidateQueries({ queryKey: ["movimentos_financeiros"] }),
      ]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível contabilizar as tarifas.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h4 className="font-semibold">Contabilização de tarifas dos novos boletos</h4>
      <p className="text-sm text-muted-foreground">
        Somente tarifas com referência comprovada a boletos de produção emitidos pelo sistema.
        Boletos antigos feitos diretamente no banco ficam fora, mesmo que gerem uma tarifa agora. A
        tarifa individual de liquidação vem do LIQUI. Documento do extrato sem referência explícita
        ao nosso número não comprova vínculo; totais agrupados não são rateados.
      </p>
      {q.isPending ? (
        <p>Carregando configuração…</p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {q.error.message}
        </p>
      ) : (
        <>
          <p className="text-sm">
            Conta financeira Sicoob:{" "}
            <strong>{q.data.conta?.nome ?? "Configure a conta na cobrança da loja"}</strong>
          </p>
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="sicoob-tarifas-categoria">Categoria da despesa</Label>
              <select
                id="sicoob-tarifas-categoria"
                className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
              >
                <option value="">Selecione a categoria financeira</option>
                {q.data.categorias.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="sicoob-tarifas-inicio">
                Data inicial das novas emissões e tarifas
              </Label>
              <Input
                id="sicoob-tarifas-inicio"
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              disabled={busy}
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
            />
            Ativar contabilização automática na conta Sicoob vinculada à loja
          </label>
          <p className="text-xs text-muted-foreground">
            Após instalar a fase361, tarifas individuais LIQUI são contabilizadas a cada cinco
            minutos, inclusive recebimentos anteriores. O extrato é consultado a cada quinze
            minutos, alternando os meses desde a data inicial dentro dos últimos três meses. Sem
            vínculo seguro, a tarifa não é importada. Valores alterados, estornos e possíveis
            despesas manuais anteriores exigem conferência; não há relançamento automático.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy || !categoria || !inicio || !q.data.conta}
              onClick={() => void executar("salvar")}
            >
              Salvar contabilização das tarifas
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || dirty || !q.data.ativo}
              onClick={() => void executar("consultar")}
            >
              Sincronizar tarifas do extrato agora
            </Button>
          </div>
          <p className="text-sm">
            Contabilizadas: {q.data.lancados} · Para conferir: {q.data.conferir}
            {q.data.ultimaConsulta
              ? ` · Última consulta: ${dataHoraBr(q.data.ultimaConsulta)}`
              : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Última contabilização LIQUI:{" "}
            {q.data.ultimaLiqui ? dataHoraBr(q.data.ultimaLiqui) : "aguardando execução da fase361"}
            .
          </p>
          {q.data.erroLiqui && (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível contabilizar as tarifas LIQUI. Confira conta, categoria e permissões
              da loja.
            </p>
          )}
          {q.data.erro && <p className="text-sm text-muted-foreground">{q.data.erro}</p>}
        </>
      )}
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
    </section>
  );
}
