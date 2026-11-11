import { SicoobExtratoConfiguracao } from "./sicoob-extrato-configuracao";
import { SicoobCondicoesEmissao } from "./sicoob-condicoes-emissao";
import { padraoEmissaoSicoob } from "@/lib/sicoob-emissao";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import { sicoobConfigGet, sicoobConfigSalvar, sicoobTestarConexao } from "@/lib/sicoob.functions";
import { SICOOB_BASE, SICOOB_SANDBOX } from "@/lib/sicoob-api";

type Modo = "homologacao" | "producao";
const vazio = { clientId: "", numeroCliente: "", numeroConta: "", numeroContrato: "" };
export function SicoobConfiguracao({
  centroId,
  contaId,
  editar,
}: {
  centroId: string;
  contaId: string;
  editar: boolean;
}) {
  const { session } = useSupabase(),
    qc = useQueryClient(),
    get = useServerFn(sicoobConfigGet),
    save = useServerFn(sicoobConfigSalvar),
    test = useServerFn(sicoobTestarConexao);
  const chaveAmbiente = session?.user.id ? `sicoob-ambiente:${session.user.id}:${centroId}` : "";
  const [preferencia, setPreferencia] = useState<{ chave: string; modo: Modo } | null>(null);
  const modo: Modo = preferencia?.chave === chaveAmbiente ? preferencia.modo : "producao";
  useEffect(() => {
    if (!chaveAmbiente) {
      setPreferencia(null);
      return;
    }
    let escolhido: Modo = "producao";
    try {
      if (window.localStorage.getItem(chaveAmbiente) === "homologacao") escolhido = "homologacao";
    } catch {
      /* A navegação permanece disponível com armazenamento bloqueado. */
    }
    setPreferencia({ chave: chaveAmbiente, modo: escolhido });
    setForm({ ...vazio });
    setToken("");
    setPfx("");
    setSenha("");
    setArquivo("");
    setError("");
  }, [chaveAmbiente]);
  function setModo(escolhido: Modo) {
    setPreferencia({ chave: chaveAmbiente, modo: escolhido });
    try {
      window.localStorage.setItem(chaveAmbiente, escolhido);
    } catch {
      /* Sem persistência neste navegador. */
    }
  }
  const [form, setForm] = useState({ ...vazio }),
    [condicoes, setCondicoes] = useState({ ...padraoEmissaoSicoob }),
    [token, setToken] = useState(""),
    [pfx, setPfx] = useState(""),
    [senha, setSenha] = useState(""),
    [arquivo, setArquivo] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const q = useQuery({
    queryKey: ["sicoob-config", session?.user.id, centroId, modo],
    enabled: !!session && preferencia?.chave === chaveAmbiente,
    refetchOnWindowFocus: false,
    queryFn: () => get({ data: { centroId, ambiente: modo, accessToken: session!.access_token } }),
  });
  useEffect(() => {
    if (!q.data) return;
    setForm({
      clientId: q.data.client_id,
      numeroCliente: String(q.data.numero_cliente || ""),
      numeroConta: String(q.data.numero_conta || ""),
      numeroContrato: String(q.data.numero_contrato || ""),
    });
    setCondicoes(q.data.condicoes_emissao);
    setToken("");
    setPfx("");
    setSenha("");
    setArquivo("");
    setError("");
  }, [q.data, modo]);
  const dirty =
    JSON.stringify(condicoes) !==
      JSON.stringify(q.data?.condicoes_emissao ?? padraoEmissaoSicoob) ||
    !!token ||
    !!pfx ||
    !!senha ||
    form.clientId !== (q.data?.client_id ?? "") ||
    form.numeroCliente !== String(q.data?.numero_cliente || "") ||
    form.numeroConta !== String(q.data?.numero_conta || "") ||
    form.numeroContrato !== String(q.data?.numero_contrato || "");
  const pronto =
    !!q.data?.certificado_configurado &&
    !!q.data?.autenticado_em &&
    q.data.autenticado_versao === q.data.versao;
  async function executar(acao: "salvar" | "testar" | "ativar" | "desativar") {
    if (busy || !session || !editar) return;
    setBusy(true);
    setError("");
    try {
      const r =
        acao === "testar"
          ? await test({ data: { centroId, ambiente: modo, accessToken: session.access_token } })
          : await save({
              data: {
                ...form,
                condicoesEmissao: condicoes,
                centroId,
                contaId: modo === "producao" ? contaId : "",
                ambiente: modo,
                versao: q.data?.versao ?? 0,
                ativo: acao === "ativar" || (acao === "salvar" && !dirty && q.data?.ativo === true),
                accessToken: session.access_token,
                ...(modo === "homologacao" && token ? { tokenSandbox: token } : {}),
                ...(modo === "producao" && pfx ? { pfx, senha } : {}),
              },
            });
      toast.success(r.mensagem);
      setToken("");
      setPfx("");
      setSenha("");
      setArquivo("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sicoob-config"] }),
        qc.invalidateQueries({ queryKey: ["sicredi_config_segura"] }),
        qc.invalidateQueries({ queryKey: ["cobranca-emissao"] }),
        qc.invalidateQueries({ queryKey: ["cobranca-status-loja"] }),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível configurar o Sicoob.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border bg-muted/20 p-4">
      <div>
        <h3 className="font-semibold">Sicoob · Cobrança Bancária v3</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure os testes com Client ID e token sandbox. A produção tem credenciais próprias e
          certificado A1.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Ambiente Sicoob">
        {(["homologacao", "producao"] as const).map((m) => (
          <Button
            key={m}
            type="button"
            variant={modo === m ? "default" : "outline"}
            disabled={busy}
            aria-pressed={modo === m}
            onClick={() => {
              setModo(m);
              setToken("");
              setPfx("");
              setSenha("");
              setArquivo("");
            }}
          >
            {m === "homologacao" ? "Sandbox · testes" : "Produção"}
          </Button>
        ))}
      </div>
      <div className="rounded-lg border bg-background p-3 text-sm">
        <strong>
          {modo === "homologacao" ? "Ambiente de testes isolado" : "Emissão de cobranças reais"}
        </strong>
        <p className="mt-1">
          {modo === "homologacao"
            ? "Boletos de sandbox ficam em Boletos → Testes Sicoob, por loja. Não geram títulos nem alteram contas a receber, estoque ou comissões."
            : "Habilite somente após o aplicativo ser aprovado pelo banco e a autenticação ser testada. Os boletos ficam vinculados à conta financeira desta loja."}
        </p>
        <p className="mt-2 break-all text-xs text-muted-foreground">
          {modo === "homologacao" ? SICOOB_SANDBOX : SICOOB_BASE}
        </p>
      </div>
      {q.isPending ? (
        <p role="status">Carregando configuração…</p>
      ) : q.isError ? (
        <p role="alert" className="text-destructive">
          {q.error.message}
        </p>
      ) : (
        <>
          {modo === "homologacao" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!editar || busy}
              onClick={() =>
                setForm((s) => ({
                  ...s,
                  numeroCliente: "25546454",
                  numeroConta: "123456",
                  numeroContrato: "1",
                }))
              }
            >
              Preencher números de exemplo do sandbox
            </Button>
          )}
          <p className="text-sm">
            <strong>
              {q.data.ativo
                ? modo === "homologacao"
                  ? "Testes habilitados"
                  : "Produção habilitada"
                : modo === "homologacao"
                  ? "Testes desativados"
                  : "Produção desativada"}
            </strong>{" "}
            ·{" "}
            {q.data.certificado_configurado
              ? "Credencial guardada no cofre"
              : "Aguardando credenciais"}
            {q.data.autenticado_em ? " · Conexão testada" : ""}
          </p>
          <fieldset disabled={!editar || busy} className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["clientId", "Client ID"],
                ["numeroCliente", "Número do cliente / beneficiário"],
                ["numeroConta", "Número da conta bancária"],
                ["numeroContrato", "Contrato de cobrança (opcional)"],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`sicoob-${modo}-${k}`}>{label}</Label>
                <Input
                  id={`sicoob-${modo}-${k}`}
                  autoComplete="off"
                  inputMode={k === "clientId" ? "text" : "numeric"}
                  value={form[k]}
                  onChange={(e) => setForm((s) => ({ ...s, [k]: e.target.value }))}
                />
              </div>
            ))}
            {modo === "homologacao" ? (
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="sicoob-sandbox-token">Token sandbox</Label>
                <Input
                  id="sicoob-sandbox-token"
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  placeholder={
                    q.data.certificado_configurado
                      ? "Já configurado. Preencha apenas para substituir"
                      : "Token fornecido pelo portal Sicoob"
                  }
                  onChange={(e) => setToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  O token é gravado no cofre e não volta a ser exibido. Use os números de cliente e
                  conta informados na documentação do seu sandbox.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label htmlFor="sicoob-certificado">Certificado digital A1 (.pfx ou .p12)</Label>
                  <Input
                    id="sicoob-certificado"
                    type="file"
                    accept=".pfx,.p12"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.size > 280 * 1024) {
                        setError("O certificado deve ter até 280 KB.");
                        return;
                      }
                      const bytes = new Uint8Array(await f.arrayBuffer());
                      let texto = "";
                      for (const b of bytes) texto += String.fromCharCode(b);
                      setPfx(btoa(texto));
                      setArquivo(f.name);
                    }}
                  />
                  {arquivo && <p className="text-xs text-muted-foreground">{arquivo}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sicoob-certificado-senha">Senha do certificado</Label>
                  <Input
                    id="sicoob-certificado-senha"
                    type="password"
                    autoComplete="new-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                </div>
              </>
            )}
          </fieldset>
          {modo === "producao" && (
            <SicoobCondicoesEmissao
              value={condicoes}
              onChange={setCondicoes}
              disabled={!editar || busy}
            />
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!editar || busy}
              onClick={() => void executar("salvar")}
            >
              Salvar configuração
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!editar || busy || dirty || !q.data.certificado_configurado}
              onClick={() => void executar("testar")}
            >
              Testar conexão
            </Button>
            {q.data.ativo ? (
              <Button
                type="button"
                variant="outline"
                disabled={!editar || busy}
                onClick={() => void executar("desativar")}
              >
                {modo === "homologacao" ? "Desativar testes" : "Desativar produção"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={!editar || busy || dirty || !pronto}
                onClick={() => void executar("ativar")}
              >
                {modo === "homologacao" ? "Habilitar testes" : "Habilitar emissão em produção"}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Salve os dados, teste a conexão e habilite o ambiente desejado. Salvar alterações
            desativa novas emissões até a próxima validação. Os registros anteriores são
            preservados.
          </p>
          {modo === "producao" && (
            <SicoobExtratoConfiguracao key={centroId} centroId={centroId} editar={editar} />
          )}
        </>
      )}
    </section>
  );
}
