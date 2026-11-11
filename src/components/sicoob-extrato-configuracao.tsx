import { SicoobTarifasConfiguracao } from "./sicoob-tarifas-configuracao";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { useSupabase } from "@/lib/supabase-provider";
import {
  sicoobExtratoConfig,
  sicoobExtratoSalvar,
  sicoobConsultarExtrato,
} from "@/lib/sicoob.functions";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { dataBr, brl } from "@/lib/formatacao";
import type { extratoParaConferenciaSicoob } from "@/lib/sicoob-extrato";

export function SicoobExtratoConfiguracao({
  centroId,
  editar,
}: {
  centroId: string;
  editar: boolean;
}) {
  const { session } = useSupabase(),
    qc = useQueryClient();
  const get = useServerFn(sicoobExtratoConfig),
    save = useServerFn(sicoobExtratoSalvar),
    consultar = useServerFn(sicoobConsultarExtrato);
  const [client, setClient] = useState(""),
    [conta, setConta] = useState(""),
    [pfx, setPfx] = useState(""),
    [senha, setSenha] = useState(""),
    [fileKey, setFileKey] = useState(0),
    [erro, setErro] = useState(""),
    [busy, setBusy] = useState(false);
  const hoje = hojeSaoPaulo();
  const [mes, setMes] = useState(hoje.slice(0, 7)),
    [inicial, setInicial] = useState(1),
    [final, setFinal] = useState(Number(hoje.slice(8, 10))),
    [soTarifas, setSoTarifas] = useState(false);
  const [resultado, setResultado] = useState<{
    transacoes: ReturnType<typeof extratoParaConferenciaSicoob>;
    consultadoEm: string;
  } | null>(null);
  const q = useQuery({
    queryKey: ["sicoob-extrato-config", session?.user.id, centroId],
    enabled: !!session && editar,
    refetchOnWindowFocus: false,
    queryFn: () => get({ data: { accessToken: session!.access_token, centroId } }),
  });
  useEffect(() => {
    setClient(q.data?.clientId ?? "");
    setConta(q.data?.numeroConta ?? "");
    setPfx("");
    setSenha("");
    setFileKey((x) => x + 1);
    setResultado(null);
    setErro("");
  }, [q.data, centroId]);
  const dirty =
    client !== (q.data?.clientId ?? "") ||
    conta !== (q.data?.numeroConta ?? "") ||
    !!pfx ||
    !!senha;
  async function executar(acao: "salvar" | "consultar") {
    if (!session || busy || !editar) return;
    setBusy(true);
    setErro("");
    setResultado(null);
    try {
      if (acao === "salvar") {
        const r = await save({
          data: {
            accessToken: session.access_token,
            centroId,
            clientId: client.trim(),
            numeroConta: conta.trim(),
            versao: q.data?.versao ?? 0,
            ...(pfx ? { pfx, senha } : {}),
          },
        });
        toast.success(r.mensagem);
        setPfx("");
        setSenha("");
        setFileKey((x) => x + 1);
        await qc.invalidateQueries({ queryKey: ["sicoob-extrato-config"] });
      } else {
        const r = await consultar({
          data: {
            accessToken: session.access_token,
            centroId,
            mes,
            diaInicial: inicial,
            diaFinal: final,
          },
        });
        setResultado(r);
        toast.success("Extrato consultado. Nenhuma despesa ou recebimento foi lançado.");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível consultar o extrato.");
    } finally {
      setBusy(false);
    }
  }
  if (!editar) return null;
  const linhas = resultado?.transacoes.filter((x) => !soTarifas || x.possivelTarifa) ?? [];
  return (
    <section className="space-y-4 rounded-xl border bg-background p-4">
      <div>
        <h4 className="font-semibold">Conta Corrente · Extrato e conferência de tarifas</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Use o Client ID do aplicativo de Conta Corrente. Esta configuração é separada da emissão
          de boletos. A consulta abaixo é de conferência. A contabilização das tarifas é configurada
          separadamente nesta seção; pagamentos não são baixados por esta consulta.
        </p>
      </div>
      {q.isPending ? (
        <p>Carregando aplicativo do extrato…</p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {q.error.message}
        </p>
      ) : (
        <>
          <p className="text-sm">
            {q.data?.certificado
              ? "Certificado do extrato guardado no cofre"
              : "Configure o certificado A1 autorizado no aplicativo de Conta Corrente"}
          </p>
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="sicoob-extrato-client">Client ID · Conta Corrente</Label>
              <Input
                id="sicoob-extrato-client"
                value={client}
                autoComplete="off"
                onChange={(e) => setClient(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sicoob-extrato-conta">
                Conta corrente (com dígito, somente números)
              </Label>
              <Input
                id="sicoob-extrato-conta"
                inputMode="numeric"
                value={conta}
                onChange={(e) => setConta(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sicoob-extrato-cert">
                Certificado A1 do aplicativo de Conta Corrente
              </Label>
              <Input
                key={fileKey}
                id="sicoob-extrato-cert"
                type="file"
                accept=".pfx,.p12"
                onChange={async (e) => {
                  setPfx("");
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 280 * 1024) {
                    setErro("Certificado deve ter até 280 KB.");
                    return;
                  }
                  const bytes = new Uint8Array(await f.arrayBuffer());
                  let s = "";
                  for (const b of bytes) s += String.fromCharCode(b);
                  setPfx(btoa(s));
                }}
              />
            </div>
            <div>
              <Label htmlFor="sicoob-extrato-senha">Senha do certificado</Label>
              <Input
                id="sicoob-extrato-senha"
                type="password"
                autoComplete="new-password"
                value={senha}
                placeholder={
                  q.data?.certificado
                    ? "Preencha somente ao substituir o certificado"
                    : "Senha do arquivo A1"
                }
                onChange={(e) => setSenha(e.target.value)}
              />
            </div>
          </fieldset>
          <Button
            type="button"
            disabled={busy || !dirty || (!!senha && !pfx)}
            onClick={() => void executar("salvar")}
          >
            Salvar aplicativo do extrato
          </Button>
          <p className="text-xs text-muted-foreground">
            Permissões de consulta: cco_consulta e openid. Não são solicitadas permissões de
            transferência. O certificado já salvo é preservado quando não houver novo arquivo.
          </p>
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="sicoob-extrato-mes">Mês do extrato</Label>
              <Input
                id="sicoob-extrato-mes"
                type="month"
                value={mes}
                onChange={(e) => {
                  setMes(e.target.value);
                  setResultado(null);
                  setInicial(1);
                  const [a, m] = e.target.value.split("-").map(Number);
                  setFinal(
                    e.target.value === hoje.slice(0, 7)
                      ? Number(hoje.slice(8, 10))
                      : new Date(a!, m!, 0).getDate(),
                  );
                }}
              />
            </div>
            <div>
              <Label htmlFor="sicoob-extrato-de">Dia inicial</Label>
              <Input
                id="sicoob-extrato-de"
                type="number"
                min="1"
                max="31"
                value={inicial}
                onChange={(e) => {
                  setInicial(Number(e.target.value));
                  setResultado(null);
                }}
              />
            </div>
            <div>
              <Label htmlFor="sicoob-extrato-ate">Dia final</Label>
              <Input
                id="sicoob-extrato-ate"
                type="number"
                min="1"
                max="31"
                value={final}
                onChange={(e) => {
                  setFinal(Number(e.target.value));
                  setResultado(null);
                }}
              />
            </div>
          </fieldset>
          <Button
            type="button"
            variant="outline"
            disabled={busy || dirty || !q.data?.certificado || !q.data.clientId}
            onClick={() => void executar("consultar")}
          >
            {busy ? "Aguarde…" : "Consultar extrato / testar conexão"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Mês atual e até três meses anteriores. Movimentos CNAB são consultados sem agrupamento.
            Aguarde quinze segundos entre consultas.
          </p>
          {resultado && (
            <div className="space-y-3">
              <p className="text-sm">
                Consulta em {dataBr(resultado.consultadoEm)} · {resultado.transacoes.length}{" "}
                movimento(s). Nenhum lançamento financeiro realizado.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={soTarifas}
                  onChange={(e) => setSoTarifas(e.target.checked)}
                />
                Mostrar somente possíveis tarifas
              </label>
              <p className="text-xs text-muted-foreground">
                A indicação de possível tarifa usa a descrição. Não comprova vínculo com boleto nem
                débito efetivo.
              </p>
              <div className="max-h-96 overflow-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th className="p-2">Data</th>
                      <th className="p-2">Tipo</th>
                      <th className="p-2">Descrição / complemento</th>
                      <th className="p-2">Documento / identificador</th>
                      <th className="p-2">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((x, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{dataBr(x.data)}</td>
                        <td className="p-2">{x.tipo || "Não informado"}</td>
                        <td className="max-w-xs break-words p-2">
                          {x.descricao}
                          <span className="block text-muted-foreground">{x.complemento}</span>
                        </td>
                        <td className="max-w-40 break-all p-2">
                          {x.documento || "—"}
                          <span className="block text-muted-foreground">
                            {x.id || "Sem identificador informado"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap p-2">
                          {x.valor === null ? "Formato não reconhecido" : brl(x.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!linhas.length && <p className="p-3 text-sm">Nenhum movimento neste filtro.</p>}
              </div>
            </div>
          )}
        </>
      )}
      <SicoobTarifasConfiguracao key={centroId} centroId={centroId} />
      {erro && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          {erro}
        </p>
      )}
    </section>
  );
}
