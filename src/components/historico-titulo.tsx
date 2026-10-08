import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import { useSupabase } from "@/lib/supabase-provider";
import { useAcesso } from "@/lib/permissoes";
import { brl } from "@/lib/formatacao";
import { OCORRENCIAS } from "@/lib/sicredi-cnab";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
type Row = Record<string, unknown>;
type Evento = { id: string; data: string; titulo: string; detalhe: string };
export function HistoricoTitulo({ titulo }: { titulo: Row }) {
  const [open, setOpen] = useState(false);
  const { client, user } = useSupabase();
  const acesso = useAcesso();
  const id = String(titulo["id"]);
  const q = useQuery({
    queryKey: ["historico-titulo", user?.id, id, acesso.pode("/boletos")],
    enabled: !!client && open,
    queryFn: async () => {
      const errors: string[] = [];
      const events: Evento[] = [];
      if (titulo["created_at"])
        events.push({
          id: "criacao",
          data: String(titulo["created_at"]),
          titulo: "Parcela criada",
          detalhe: `Documento ${titulo["documento"] ?? "—"} · parcela ${titulo["parcela"] ?? "—"} · ${brl(titulo["valor"])}`,
        });
      const [mov, books] = await Promise.all([
        client!
          .from("movimentos_financeiros")
          .select("*", { count: "exact" })
          .eq("conta_receber_id", id)
          .order("data", { ascending: false })
          .limit(100),
        acesso.pode("/boletos")
          ? client!
              .from("boletos")
              .select("*")
              .eq("conta_receber_id", id)
              .order("created_at", { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (mov.error) errors.push("Recebimentos indisponíveis. Tente atualizar.");
      else
        for (const r of (mov.data ?? []) as unknown as Row[])
          events.push({
            id: `mov:${r["id"]}`,
            data: String(r["created_at"] ?? r["data"]),
            titulo: r["tipo"] === "entrada" ? "Recebimento lançado" : "Movimentação financeira",
            detalhe: `${brl(r["valor"])} · ${r["descricao"] ?? ""}`,
          });
      if (mov.count && mov.count > 100)
        errors.push(
          "Exibindo os 100 movimentos mais recentes. Consulte Conciliação / movimentações para o histórico completo.",
        );
      if (books.error) errors.push("Dados dos boletos indisponíveis. Tente atualizar.");
      const boletos = (books.data ?? []) as unknown as Row[];
      for (const b of boletos)
        events.push({
          id: `boleto:${b["id"]}`,
          data: String(b["created_at"] ?? ""),
          titulo: "Emissão de boleto solicitada",
          detalhe: `${b["canal"] ?? "API"} · nosso número ${b["nosso_numero"] ?? "aguardando banco"} · situação atual: ${b["status"]}${b["erro"] ? ` · ${b["erro"]}` : ""}`,
        });
      for (const b of boletos)
        if (b["data_liquidacao"])
          events.push({
            id: `liquidacao:${b["id"]}`,
            data: String(b["data_liquidacao"]),
            titulo: "Liquidação bancária",
            detalhe: `Nosso número ${b["nosso_numero"] ?? "—"} · ${brl(b["valor_liquidado"])}`,
          });
      if (boletos.length) {
        const ids = boletos.map((b) => String(b["id"]));
        const [cnab, changes] = await Promise.all([
          client!
            .from("sicredi_cnab_eventos")
            .select("*")
            .in("boleto_id", ids)
            .order("created_at", { ascending: false })
            .limit(100),
          client!
            .from("sicredi_boleto_alteracoes")
            .select("*")
            .in("boleto_id", ids)
            .order("created_at", { ascending: false })
            .limit(100),
        ]);
        if (cnab.error) errors.push("Eventos CNAB indisponíveis.");
        else
          for (const e of (cnab.data ?? []) as unknown as Row[])
            events.push({
              id: `cnab:${e["id"]}`,
              data: String(e["created_at"]),
              titulo: OCORRENCIAS[String(e["ocorrencia"])] ?? `Retorno CNAB ${e["ocorrencia"]}`,
              detalhe: "Ocorrência importada do arquivo de retorno Sicredi.",
            });
        if (changes.error) errors.push("Alterações de vencimento indisponíveis.");
        else
          for (const c of (changes.data ?? []) as unknown as Row[])
            events.push({
              id: `venc:${c["id"]}`,
              data: String(c["created_at"]),
              titulo: "Alteração de vencimento solicitada",
              detalhe: `${c["vencimento_anterior"]} → ${c["vencimento_novo"]} · situação atual: ${c["estado"]}`,
            });
      }
      return {
        events: events.sort((a, b) => (Date.parse(b.data) || 0) - (Date.parse(a.data) || 0)),
        errors,
      };
    },
  });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Clock3 className="size-3.5" />
        Histórico
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Histórico da parcela</DialogTitle>
            <DialogDescription>
              Documento {String(titulo["documento"] ?? "—")} · parcela{" "}
              {String(titulo["parcela"] ?? "—")} · saldo {brl(titulo["saldo"])}. Eventos disponíveis
              conforme seu acesso.
            </DialogDescription>
          </DialogHeader>
          <Button
            variant="outline"
            size="sm"
            disabled={q.isFetching}
            onClick={() => void q.refetch()}
          >
            Atualizar histórico
          </Button>
          {q.isPending ? (
            <p role="status">Carregando histórico…</p>
          ) : q.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar o histórico.
            </p>
          ) : (
            <>
              {q.data?.errors.map((e) => (
                <p key={e} role="alert" className="text-xs text-destructive">
                  {e}
                </p>
              ))}
              <ol className="space-y-4 border-l pl-4">
                {q.data?.events.map((e) => (
                  <li key={e.id}>
                    <p className="text-xs text-muted-foreground">
                      {e.data && !isNaN(Date.parse(e.data))
                        ? new Date(
                            e.data.length === 10 ? `${e.data}T12:00:00-03:00` : e.data,
                          ).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
                        : "Data não disponível"}
                    </p>
                    <h3 className="mt-1 text-sm font-medium">{e.titulo}</h3>
                    <p className="mt-1 break-words text-xs text-muted-foreground">{e.detalhe}</p>
                  </li>
                ))}
              </ol>
              {!q.data?.events.length && (
                <p className="text-sm text-muted-foreground">
                  Nenhum evento disponível. Situação atual: {String(titulo["status"] ?? "—")}.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Solicitações mostram o estado atual; os horários de confirmação só aparecem quando
                existe um evento registrado. Até 100 eventos por fonte.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
