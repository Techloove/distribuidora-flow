import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "./ui/table";
import { AcoesBoletoSicoob } from "./acoes-boleto-sicoob";
import { useSupabase } from "@/lib/supabase-provider";
import { sicoobConfigGet, sicoobEmitirSandbox } from "@/lib/sicoob.functions";
import { brl, dataBr } from "@/lib/formatacao";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { Link } from "@tanstack/react-router";

type Row = Record<string, unknown>;
const vazio = {
  numeroCpfCnpj: "",
  nome: "PAGADOR SANDBOX",
  endereco: "",
  bairro: "",
  cidade: "",
  uf: "",
  cep: "",
};
export function SicoobSandbox({ centroId }: { centroId: string }) {
  const permissoes = usePermissoesRotinas();
  const { client, session, roles } = useSupabase(),
    qc = useQueryClient(),
    get = useServerFn(sicoobConfigGet),
    emitir = useServerFn(sicoobEmitirSandbox);
  const [open, setOpen] = useState(false),
    [form, setForm] = useState({ ...vazio }),
    [valor, setValor] = useState("100"),
    [vencimento, setVencimento] = useState(hojeSaoPaulo()),
    [chave, setChave] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [erro, setErro] = useState("");
  const finance = roles.some((r) => ["admin", "gestor", "financeiro"].includes(r));
  const config = useQuery({
    queryKey: ["sicoob-config", session?.user.id, centroId, "homologacao"],
    enabled: open && !!session && !!centroId && finance && permissoes.pode("sicoob_operar"),
    refetchOnWindowFocus: false,
    queryFn: () =>
      get({ data: { centroId, ambiente: "homologacao", accessToken: session!.access_token } }),
  });
  const lista = useQuery({
    queryKey: ["sicoob-sandbox", session?.user.id, centroId],
    enabled: open && !!client && !!centroId && finance && permissoes.pode("sicoob_operar"),
    queryFn: async () => {
      const { data, error } = await client!
        .from("sicoob_sandbox_316")
        .select(
          "id,centro_id,banco,canal,ambiente,seu_numero,nosso_numero,valor,vencimento,status,sicoob_pendente_316,retorno,erro,created_at",
        )
        .eq("centro_id", centroId)
        .order("created_at", { ascending: false })
        .order("id")
        .limit(100);
      if (error) throw Error("Não foi possível carregar os testes desta loja.");
      return data as Row[];
    },
  });
  if (!finance || !permissoes.pode("sicoob_operar")) return null;
  async function executar() {
    if (busy || !session || !centroId) return;
    setBusy(true);
    setErro("");
    try {
      const r = await emitir({
        data: {
          centroId,
          chave,
          valor,
          vencimento,
          pagador: form,
          accessToken: session.access_token,
        },
      });
      toast.success(r.mensagem);
      setChave(crypto.randomUUID());
      setForm({ ...vazio });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível executar o teste.");
    } finally {
      await qc.invalidateQueries({ queryKey: ["sicoob-sandbox"] });
      setBusy(false);
    }
  }
  return (
    <details
      className="rounded-xl border bg-card p-4"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">
        Testes opcionais de homologação Sicoob
      </summary>
      <div className="mt-4 space-y-4">
        <p className="rounded-lg border bg-muted/30 p-3 text-sm">
          <strong>SANDBOX · sem efeito financeiro.</strong> Os registros abaixo são testes do banco.
          Não criam títulos a receber, pagamentos, estoque ou comissões. O Sicoob pode devolver
          respostas fixas de exemplo: nesses casos, mostramos Resposta simulada recebida. Esses
          dados não comprovam registro de boleto ou alterações bancárias.
        </p>
        {!centroId ? (
          <p role="status" className="text-sm">
            Selecione a loja no filtro do topo para consultar e executar os testes.
          </p>
        ) : (
          <>
            {config.isPending ? (
              <p role="status">Consultando configuração do sandbox…</p>
            ) : config.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {config.error.message}
              </p>
            ) : !config.data.ativo ? (
              <p className="text-sm">
                Configure o Client ID e token sandbox em{" "}
                <Link to="/centros" className="text-primary underline">
                  Lojas → Cobrança por loja → Sicoob → Sandbox
                </Link>
                , teste a conexão e habilite os testes.
              </p>
            ) : (
              <>
                <fieldset disabled={busy} className="space-y-3 rounded-lg border p-4">
                  <legend className="px-1 text-sm font-medium">Emitir boleto de teste</legend>
                  <p className="text-xs text-muted-foreground">
                    Preencha os dados de pagador definidos no seu sandbox. Nenhum cliente real
                    precisa ser cadastrado.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setForm({
                        numeroCpfCnpj: "12345678909",
                        nome: "PAGADOR EXEMPLO SANDBOX",
                        endereco: "Rua de Teste, 1",
                        bairro: "Centro",
                        cidade: "Brasília",
                        uf: "DF",
                        cep: "70040902",
                      });
                      setChave(crypto.randomUUID());
                    }}
                  >
                    Preencher pagador de exemplo
                  </Button>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(
                      [
                        ["numeroCpfCnpj", "CPF/CNPJ do pagador de teste"],
                        ["nome", "Nome do pagador de teste"],
                        ["endereco", "Endereço"],
                        ["bairro", "Bairro"],
                        ["cidade", "Cidade"],
                        ["uf", "UF"],
                        ["cep", "CEP"],
                      ] as const
                    ).map(([k, label]) => (
                      <div key={k} className="space-y-1">
                        <Label htmlFor={`sandbox-${k}`}>{label}</Label>
                        <Input
                          id={`sandbox-${k}`}
                          value={form[k]}
                          maxLength={k === "uf" ? 2 : k === "nome" ? 50 : 150}
                          onChange={(e) => {
                            setForm((s) => ({
                              ...s,
                              [k]: k === "uf" ? e.target.value.toUpperCase() : e.target.value,
                            }));
                            setChave(crypto.randomUUID());
                          }}
                        />
                      </div>
                    ))}
                    <div className="space-y-1">
                      <Label htmlFor="sandbox-valor">Valor do teste (R$)</Label>
                      <Input
                        id="sandbox-valor"
                        currency
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={valor}
                        onChange={(e) => {
                          setValor(e.target.value);
                          setChave(crypto.randomUUID());
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="sandbox-vencimento">Vencimento do teste</Label>
                      <Input
                        id="sandbox-vencimento"
                        type="date"
                        value={vencimento}
                        onChange={(e) => {
                          setVencimento(e.target.value);
                          setChave(crypto.randomUUID());
                        }}
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    disabled={
                      busy || !Object.values(form).every((v) => v.trim()) || Number(valor) <= 0
                    }
                    onClick={() => void executar()}
                  >
                    {busy ? "Executando teste…" : "Emitir no sandbox"}
                  </Button>
                </fieldset>
              </>
            )}
            {erro && (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium">Últimos 100 boletos de teste desta loja</h3>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || lista.isFetching}
                onClick={() => void lista.refetch()}
              >
                Atualizar testes
              </Button>
            </div>
            {lista.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {lista.error.message}
              </p>
            ) : lista.isPending ? (
              <p role="status">Carregando testes…</p>
            ) : !lista.data.length ? (
              <p className="text-sm text-muted-foreground">Nenhum teste nesta loja.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table className="mobile-cards">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Identificação do teste</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead>Ações de teste</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lista.data.map((b) => (
                      <TableRow key={String(b["id"])}>
                        <TableCell data-label="Identificação">
                          <strong>SANDBOX</strong>
                          <p className="text-xs">{String(b["nosso_numero"] ?? b["seu_numero"])}</p>
                        </TableCell>
                        <TableCell data-label="Vencimento">{dataBr(b["vencimento"])}</TableCell>
                        <TableCell data-label="Valor">{brl(b["valor"])}</TableCell>
                        <TableCell data-label="Situação">
                          {b["status"] === "simulado"
                            ? "Resposta simulada recebida"
                            : String(b["status"])}
                          {b["erro"] ? (
                            <p className="mt-1 max-w-xs text-xs text-destructive">
                              {String(b["erro"])}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell data-label="Ações">
                          {b["status"] === "simulado" ? (
                            <p className="max-w-md text-sm text-muted-foreground">
                              Comunicação validada com resposta fixa do sandbox. Valor e vencimento
                              nesta linha são os enviados no teste. O mock não confirma registro,
                              PDF ou alterações desse boleto.
                            </p>
                          ) : (
                            <AcoesBoletoSicoob boleto={b} sandbox />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
