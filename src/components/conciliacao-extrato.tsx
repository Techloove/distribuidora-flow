import { getModalidade } from "@/lib/modalidade-store";
import { lerExtratoOfx } from "@/lib/importacoes-distribuidora";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { exportarCsv } from "@/lib/exportar";
import { hojeSaoPaulo } from "@/lib/painel-trabalho";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useSupabaseAnalitico as useSupabase } from "@/lib/supabase-provider";
import { brl } from "@/lib/formatacao";
import {
  candidatosConciliacao,
  lerExtratoCsv,
  type Registro,
  type LinhaExtrato,
} from "@/lib/rotinas-distribuidora";
import { AvisoRotina } from "@/components/rotinas-distribuidora";
import { useRotinaRpc } from "@/lib/use-rotina-rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ConciliacaoExtrato() {
  const permissoes = usePermissoesRotinas();
  const { client, user, roles } = useSupabase();
  const permitido =
    permissoes.pode("extrato_ver") &&
    roles.some((r) => ["admin", "gestor", "financeiro"].includes(r)) &&
    (!roles.includes("representante") || roles.includes("admin"));
  const [conta, setConta] = useState("");
  const [linhas, setLinhas] = useState<LinhaExtrato[]>([]);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [pagina, setPagina] = useState(0);
  const [situacao, setSituacao] = useState("pendente");
  const rpc = useRotinaRpc(["extrato_bancario_linhas"]);
  const contas = useQuery({
    queryKey: [...["contas-fin-conciliacao", user?.id], getModalidade()],
    enabled: !!client && permitido,
    queryFn: async () => {
      const { data, error } = await client!
        .from("contas_financeiras")
        .select("id,nome,banco_codigo,agencia,conta")
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Registro[];
    },
  });
  const extrato = useQuery({
    queryKey: [...["extrato_bancario_linhas", user?.id, conta, pagina, situacao], getModalidade()],
    enabled: !!client && permitido && !!conta,
    queryFn: async () => {
      let r = client!
        .from("extrato_bancario_linhas")
        .select("*", { count: "exact" })
        .eq("conta_id", conta);
      r = situacao === "pendente" ? r.is("movimento_id", null) : r.not("movimento_id", "is", null);
      const { data, error, count } = await r
        .order("data", { ascending: false })
        .order("referencia")
        .range(pagina * 50, pagina * 50 + 49);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as Registro[], count: count ?? 0 };
    },
  });
  const movimentos = useQuery({
    queryKey: [
      ...[
        "movimentos-conciliacao",
        user?.id,
        conta,
        extrato.data?.rows.map((r) => r["id"]).join(","),
      ],
      getModalidade(),
    ],
    enabled: !!client && permitido && !!conta && !!extrato.data?.rows.length,
    queryFn: async () => {
      const datas = extrato.data!.rows.map((r) => String(r["data"])).sort();
      const inicio = new Date(datas[0] + "T12:00:00Z");
      inicio.setUTCDate(inicio.getUTCDate() - 7);
      const fim = new Date(datas.at(-1) + "T12:00:00Z");
      fim.setUTCDate(fim.getUTCDate() + 7);
      const { data, error, count } = await client!
        .from("movimentos_financeiros")
        .select("*", { count: "exact" })
        .eq("conta_id", conta)
        .eq("status", "ativo")
        .gte("data", inicio.toISOString().slice(0, 10))
        .lte("data", fim.toISOString().slice(0, 10))
        .order("data")
        .limit(1000);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as Registro[], count };
    },
  });
  if (!permitido) return null;
  async function arquivo(file: File | undefined) {
    setLinhas([]);
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Arquivo excede 2 MB.");
      setLinhas(
        file.name.toLowerCase().endsWith(".ofx")
          ? lerExtratoOfx(await file.text(), {
              banco: String(contas.data?.find((c) => c["id"] === conta)?.["banco_codigo"] ?? ""),
              agencia: String(contas.data?.find((c) => c["id"] === conta)?.["agencia"] ?? ""),
              numero: String(contas.data?.find((c) => c["id"] === conta)?.["conta"] ?? ""),
            })
          : lerExtratoCsv(await file.text()),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "CSV inválido");
    }
  }
  return (
    <section className="rounded border bg-card p-4 space-y-4">
      <h2 className="font-semibold">Conciliação do extrato bancário</h2>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          exportarCsv(
            "modelo-extrato",
            ["referencia", "data", "valor", "descricao"].map((key) => ({ key, label: key })),
            [
              { referencia: "TX001", data: hojeSaoPaulo(), valor: 125.5, descricao: "Recebimento" },
              { referencia: "TX002", data: hojeSaoPaulo(), valor: -3.25, descricao: "Tarifa" },
            ],
          )
        }
      >
        Baixar modelo CSV
      </Button>
      <p className="text-xs text-muted-foreground">
        Importe OFX do Sicredi (referência FITID) ou CSV com cabeçalho
        referencia;data;valor;descricao. Data AAAA-MM-DD, entradas positivas e saídas negativas. Use
        a referência única do banco. Exemplo: TX001;2026-10-08;125,50;Recebimento. A importação não
        baixa parcelas; vincule a movimentação já registrada.
      </p>
      <AvisoRotina erro={contas.error} />
      <label className="block text-sm">
        Conta bancária
        <select
          aria-label="Conta para conciliação"
          className="mt-1 w-full rounded border bg-background p-2"
          value={conta}
          onChange={(e) => {
            setConta(e.target.value);
            setPagina(0);
            setLinhas([]);
          }}
        >
          <option value="">Selecione a conta</option>
          {contas.data?.map((c) => (
            <option key={String(c["id"])} value={String(c["id"])}>
              {String(c["nome"])}
            </option>
          ))}
        </select>
      </label>
      {conta && (
        <>
          <label className="block text-sm">
            Extrato CSV ou OFX
            <Input
              type="file"
              accept=".csv,.ofx,text/csv,application/x-ofx"
              disabled={!permissoes.pode("extrato_importar") || rpc.isPending}
              onChange={(e) => void arquivo(e.target.files?.[0])}
            />
          </label>
          {linhas.length > 0 && (
            <div className="rounded border p-3 text-sm space-y-2">
              <p>
                {linhas.length} linhas validadas · entradas{" "}
                {brl(linhas.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0))} · saídas{" "}
                {brl(-linhas.filter((l) => l.valor < 0).reduce((s, l) => s + l.valor, 0))}
              </p>
              <Button
                disabled={!permissoes.pode("extrato_importar") || rpc.isPending}
                onClick={() =>
                  rpc.mutate(
                    {
                      nome: "importar_extrato_bancario",
                      args: { _conta_id: conta, _linhas: linhas },
                    },
                    {
                      onSuccess: (n) => {
                        toast.success(`${String(n)} novas linhas importadas`);
                        setLinhas([]);
                      },
                    },
                  )
                }
              >
                Importar linhas conferidas
              </Button>
            </div>
          )}
          <select
            aria-label="Situação da conciliação"
            className="rounded border bg-background p-2 text-sm"
            value={situacao}
            onChange={(e) => {
              setSituacao(e.target.value);
              setPagina(0);
            }}
          >
            <option value="pendente">Pendentes</option>
            <option value="conciliado">Conciliadas</option>
          </select>
          <AvisoRotina erro={extrato.error} />
          <AvisoRotina erro={movimentos.error} />
          {extrato.isPending ? (
            <p>Carregando extrato…</p>
          ) : (
            extrato.data?.rows.map((l) => {
              const id = String(l["id"]);
              const candidatos = candidatosConciliacao(l, movimentos.data?.rows ?? []);
              return (
                <article className="rounded border p-3 space-y-2 text-sm" key={id}>
                  <strong>
                    {String(l["data"])} · {brl(l["valor"])} · {String(l["referencia"])}
                  </strong>
                  <p>{String(l["descricao"] ?? "")}</p>
                  {l["movimento_id"] != null ? (
                    <>
                      <p className="text-xs">Movimento vinculado: {String(l["movimento_id"])}</p>
                      <div className="flex flex-wrap gap-2">
                        <Input
                          aria-label="Motivo para desfazer conciliação"
                          placeholder="Motivo para desfazer"
                          value={motivos[id] ?? ""}
                          onChange={(e) => setMotivos((s) => ({ ...s, [id]: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !permissoes.pode("extrato_desconciliar") ||
                            rpc.isPending ||
                            !motivos[id]?.trim()
                          }
                          onClick={() =>
                            rpc.mutate({
                              nome: "desconciliar_extrato",
                              args: { _linha_id: id, _motivo: motivos[id] },
                            })
                          }
                        >
                          Desfazer vínculo
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <select
                        aria-label={`Movimento para ${l["referencia"]}`}
                        className="w-full rounded border bg-background p-2"
                        value={escolhas[id] ?? ""}
                        onChange={(e) => setEscolhas((s) => ({ ...s, [id]: e.target.value }))}
                      >
                        <option value="">
                          {candidatos.length
                            ? "Selecione o movimento correspondente"
                            : "Sem candidato pelo valor; confira Movimentações"}
                        </option>
                        {candidatos.map((m) => (
                          <option key={String(m["id"])} value={String(m["id"])}>
                            {String(m["data"])} · {String(m["documento"] ?? "")} ·{" "}
                            {String(m["descricao"] ?? "Movimento")} · {brl(m["valor"])}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        disabled={
                          !permissoes.pode("extrato_conciliar") || rpc.isPending || !escolhas[id]
                        }
                        onClick={() =>
                          rpc.mutate({
                            nome: "conciliar_extrato",
                            args: { _linha_id: id, _movimento_id: escolhas[id] },
                          })
                        }
                      >
                        Conciliar
                      </Button>
                    </>
                  )}
                </article>
              );
            })
          )}
          {!extrato.isPending && !extrato.error && !extrato.data?.rows.length && (
            <p className="text-sm text-muted-foreground">Sem linhas nesta situação.</p>
          )}
          <div className="flex gap-2 items-center">
            <Button
              variant="outline"
              disabled={pagina === 0 || extrato.isFetching}
              onClick={() => setPagina((p) => p - 1)}
            >
              Anterior
            </Button>
            <span className="text-xs">
              Página {pagina + 1} · {extrato.data?.count ?? 0} linhas
            </span>
            <Button
              variant="outline"
              disabled={extrato.isFetching || (pagina + 1) * 50 >= (extrato.data?.count ?? 0)}
              onClick={() => setPagina((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Sugestões usam a mesma conta e valor, com movimentos até 7 dias antes/depois do período
            exibido. O servidor impede reutilizar uma movimentação.
          </p>
          {(movimentos.data?.count ?? 0) > 1000 && (
            <p className="text-xs text-amber-700">
              Os candidatos foram limitados a 1000 movimentos. Restrinja o período de extrato para
              conferir os restantes.
            </p>
          )}
        </>
      )}
    </section>
  );
}
