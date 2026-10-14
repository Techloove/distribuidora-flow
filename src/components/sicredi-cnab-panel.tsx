import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import { useCentro } from "@/lib/centro-store";
import { OCORRENCIAS, nomeRemessaHomologacao, type CnabConfig } from "@/lib/sicredi-cnab";
import { cnabImportarRetorno, cnabPreverRetorno } from "@/lib/sicredi-cnab.functions";

type Row = Record<string, unknown>;
function download(content: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([Uint8Array.from(content, (char) => char.charCodeAt(0))], {
      type: "application/octet-stream",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function SicrediCnabPanel() {
  const { centro } = useCentro();
  const { roles } = useSupabase();
  if (!roles.some((r) => ["admin", "gestor", "financeiro"].includes(r))) return null;
  return (
    <section className="no-print rounded-xl border bg-card p-4">
      <h2 className="font-semibold">Sicredi · CNAB 240</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Confira os retornos do Sicredi e consulte os arquivos de cobrança.
      </p>
      {!centro ? (
        <p className="mt-3 text-sm">
          Selecione um centro de custo específico no filtro superior para trabalhar com CNAB.
        </p>
      ) : (
        <CentroCnab key={centro} centro={centro} />
      )}
    </section>
  );
}
function CentroCnab({ centro }: { centro: string }) {
  const { client, session } = useSupabase();
  const qc = useQueryClient();
  const preview = useServerFn(cnabPreverRetorno),
    apply = useServerFn(cnabImportarRetorno);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState(""),
    [filename, setFilename] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof preview>> | null>(null);
  const input = () => ({ centro_id: centro, accessToken: session!.access_token });
  const cfg = useQuery({
    queryKey: ["cnab", "config", "compartilhada"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("sicredi_cnab_config").select("*").maybeSingle();
      if (error)
        throw new Error("Não foi possível carregar CNAB. Aplique a migração fase208 no Supabase.");
      return data as CnabConfig | null;
    },
  });
  const centers = useQuery({
    queryKey: ["cnab", "centros"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("centros").select("id,nome");
      if (error) throw new Error("Não foi possível carregar os centros.");
      return data ?? [];
    },
  });
  const history = useQuery({
    queryKey: ["cnab", "arquivos", centro],
    enabled: !!client && !!cfg.data,
    queryFn: async () => {
      const { data, error } = await client!
        .from("sicredi_cnab_arquivos")
        .select("id,tipo,nome,quantidade,created_at")
        .eq("centro_id", centro)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });
  async function run(fn: () => Promise<void>) {
    if (busy || !session) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na rotina CNAB.");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["cnab"] }),
      qc.invalidateQueries({ queryKey: ["boletos"] }),
      qc.invalidateQueries({ queryKey: ["vw_boletos_pendentes"] }),
      qc.invalidateQueries({ queryKey: ["contas_receber"] }),
    ]);
  }
  return (
    <div className="mt-4 space-y-4">
      {cfg.isError && (
        <p role="alert" className="text-sm text-destructive">
          {cfg.error.message}
        </p>
      )}
      {cfg.isLoading && <p role="status">Carregando CNAB…</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!cfg.isLoading && !cfg.isError && !cfg.data && (
        <p className="text-sm">
          Convênio CNAB compartilhado não configurado. Solicite a configuração ao administrador em{" "}
          <Link to="/configuracoes" className="underline">
            Configurações do sistema
          </Link>
          .
        </p>
      )}
      {cfg.data && (
        <>
          {!cfg.data.homologado && (
            <p className="rounded-md border p-3 text-sm">
              Convênio em homologação. Emita pelos pedidos e envie a remessa para validação com a
              cooperativa. A aplicação de retornos ficará disponível após confirmar a homologação.
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Importar retorno CNAB 240
            </summary>
            <Label htmlFor="cnab-retorno" className="mt-3 block">
              Arquivo de retorno fornecido pelo Sicredi (até 2 MB)
            </Label>
            <Input
              id="cnab-retorno"
              className="mt-2"
              type="file"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                setResult(null);
                setConfirmed(false);
                setContent("");
                setFilename("");
                if (!file) return;
                void run(async () => {
                  if (file.size > 2_000_000) throw new Error("Arquivo excede 2 MB.");
                  const text = new TextDecoder("windows-1252").decode(await file.arrayBuffer());
                  const parsed = await preview({ data: { ...input(), content: text } });
                  setContent(text);
                  setFilename(file.name);
                  setResult(parsed);
                });
              }}
            />
            {result && (
              <>
                <div className="mt-3 max-h-72 overflow-auto rounded-md border">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th className="p-2">Nosso número</th>
                        <th>Centro da venda</th>
                        <th>Ocorrência</th>
                        <th>Recebido</th>
                        <th>Vencimento</th>
                        <th>Conferência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.eventos.map((e, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{e.nosso_numero}</td>
                          <td>{centers.data?.find((c) => c.id === e.centro_id)?.nome ?? "—"}</td>
                          <td>
                            {OCORRENCIAS[e.ocorrencia] ??
                              `Ocorrência ${e.ocorrencia}: registrada sem alterar títulos`}
                          </td>
                          <td>R$ {e.valor_recebido}</td>
                          <td>{e.vencimento ?? "—"}</td>
                          <td>
                            {e.problema ?? `Localizado · ${e.status_atual}`}
                            {e.motivos && ` · motivos ${e.motivos}`}
                            {e.pix?.url && " · QR Code PIX recebido"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="my-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  Confirmo que o arquivo veio do Sicredi e conferi os valores e ocorrências.
                </label>
                <Button
                  disabled={
                    busy ||
                    !confirmed ||
                    !result.homologado ||
                    result.eventos.some((e) => e.problema)
                  }
                  onClick={() =>
                    void run(async () => {
                      await apply({
                        data: { ...input(), content, filename, confirmado: confirmed },
                      });
                      setResult(null);
                      setContent("");
                      setConfirmed(false);
                      await refresh();
                      toast.success("Retorno aplicado. Reimportações não duplicam recebimentos.");
                    })
                  }
                >
                  Aplicar retorno conferido
                </Button>
              </>
            )}
          </details>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Últimos arquivos e download
            </summary>
            {history.isError && <p role="alert">{history.error.message}</p>}
            {(history.data ?? []).map((a) => (
              <div
                key={String(a["id"])}
                className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  {String(a["tipo"])} · {String(a["nome"])} · {String(a["quantidade"])} títulos ·{" "}
                  {new Date(String(a["created_at"])).toLocaleString("pt-BR")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const { data, error } = await client!
                        .from("sicredi_cnab_arquivos")
                        .select("conteudo,nome")
                        .eq("id", a["id"])
                        .eq("centro_id", centro)
                        .single();
                      if (error) throw new Error("Não foi possível recuperar o arquivo.");
                      download(String(data.conteudo), String(data.nome));
                    })
                  }
                >
                  Baixar arquivo
                </Button>
                {a["tipo"] === "remessa" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const { data, error } = await client!
                          .from("sicredi_cnab_arquivos")
                          .select("conteudo,nome")
                          .eq("id", a["id"])
                          .eq("centro_id", centro)
                          .single();
                        if (error) throw new Error("Não foi possível recuperar a remessa.");
                        download(
                          String(data.conteudo),
                          nomeRemessaHomologacao(String(data.nome), String(data.conteudo)),
                        );
                        toast.info(
                          "Cópia para homologação. Nenhum título ou sequencial novo foi gerado.",
                        );
                      })
                    }
                  >
                    Baixar .CRM para homologação
                  </Button>
                )}
              </div>
            ))}
          </details>
        </>
      )}
    </div>
  );
}
