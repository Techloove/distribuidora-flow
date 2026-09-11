import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Receipt, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  consultarInscricaoEstadual,
  type ConsultaIeResultado,
  type RegistroFiscal,
} from "@/lib/inscricao-estadual.functions";
import { useSupabase } from "@/lib/supabase-provider";

type Row = Record<string, unknown>;

const digitos = (v: string) => (v ?? "").replace(/\D+/g, "");

/** Apresenta a IE em blocos de 3, mantendo o valor gravado normalizado. */
export function formatarIe(ie: string) {
  const v = (ie ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!/^\d+$/.test(v) || v.length < 8) return v;
  return v.replace(/(.{3})(?=.)/g, "$1.");
}

/**
 * Consulta a Inscrição Estadual do cliente PJ a partir do CNPJ já cadastrado.
 * Usa a mesma estrutura de consulta cadastral: serviço no servidor, cache e
 * histórico. Só grava dados fiscais — nada de comercial é alterado.
 */
export function ConsultaIe({
  form,
  editing,
  patch,
  escopo = "clientes",
}: {
  form: Record<string, string | boolean>;
  editing: Row | null;
  patch: (values: Record<string, string>) => void;
  escopo?: "clientes" | "pessoas";
}) {
  const { client, canManage } = useSupabase();
  const queryClient = useQueryClient();
  const consultar = useServerFn(consultarInscricaoEstadual);
  const [resultado, setResultado] = useState<null | {
    registros: RegistroFiscal[];
    provedor: string;
    ufEstabelecimento?: string | undefined;
    mensagem?: string | undefined;
    doCache: boolean;
    consultadoEm: string;
  }>(null);
  const [escolhido, setEscolhido] = useState<string | null>(null);

  const doc = digitos(String(form["cnpj_cpf"] ?? ""));
  const ieAtual = String(form["inscricao_estadual"] ?? "").trim();
  const editandoId = editing ? String(editing["id"]) : null;
  const pj = String(form["tipo_pessoa"] ?? "") !== "PF" && doc.length === 14;

  const historico = useQuery({
    queryKey: ["consultas_log_ie", doc],
    enabled: !!client && doc.length === 14,
    queryFn: async () => {
      const { data, error } = await client!
        .from("consultas_log")
        .select("created_at, provedor, resultado, mensagem, inscricao_estadual, uf_inscricao")
        .eq("documento", doc)
        .eq("tipo", "IE")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) return [] as Row[];
      return (data ?? []) as Row[];
    },
  });

  async function registrar(
    resultadoTexto: string,
    provedor: string | null,
    mensagem: string | null,
    reg: RegistroFiscal | null,
    doCache: boolean,
  ) {
    if (!client) return;
    await client.from("consultas_log").insert({
      documento: doc,
      tipo: "IE",
      provedor,
      resultado: resultadoTexto,
      mensagem,
      cliente_id: escopo === "clientes" ? editandoId : null,
      pessoa_id: escopo === "pessoas" ? editandoId : null,
      origem_cache: doCache,
      inscricao_estadual: reg?.inscricao ?? null,
      uf_inscricao: reg?.uf ?? null,
      situacao_inscricao: reg?.situacao ?? null,
    });
    queryClient.invalidateQueries({ queryKey: ["consultas_log_ie", doc] });
  }

  const buscar = useMutation({
    mutationFn: async (forcar: boolean) => {
      if (!client) throw new Error("Sessão indisponível. Entre novamente.");
      if (doc.length !== 14) throw new Error("Informe um CNPJ com 14 números.");

      if (!forcar) {
        const { data: cache } = await client
          .from("consultas_ie")
          .select("provedor, dados, consultado_em")
          .eq("documento", doc)
          .gt("expira_em", new Date().toISOString())
          .maybeSingle();
        if (cache) {
          const d = (cache["dados"] ?? {}) as Record<string, unknown>;
          const registros = (Array.isArray(d["registros"]) ? d["registros"] : []) as RegistroFiscal[];
          await registrar("cache", String(cache["provedor"]), null, registros[0] ?? null, true);
          return {
            registros,
            provedor: String(cache["provedor"]),
            ufEstabelecimento: d["uf_estabelecimento"] as string | undefined,
            mensagem: d["mensagem"] as string | undefined,
            doCache: true,
            consultadoEm: String(cache["consultado_em"]),
          };
        }
      }

      const res = (await consultar({ data: { documento: doc } })) as ConsultaIeResultado;
      if (!res.ok) {
        await registrar(res.codigo, null, res.mensagem, null, false);
        throw new Error(res.mensagem);
      }

      const dados = {
        registros: res.registros,
        uf_estabelecimento: res.uf_estabelecimento ?? null,
        isento: res.isento,
        mensagem: res.mensagem ?? null,
      };
      await client.from("consultas_ie").upsert(
        {
          documento: res.documento,
          provedor: res.provedor,
          dados,
          consultado_em: new Date().toISOString(),
          expira_em: new Date(Date.now() + res.validadeDias * 86400000).toISOString(),
        },
        { onConflict: "documento" },
      );
      await registrar(
        res.registros.length > 0 ? "sucesso" : res.isento ? "isento" : "sem_ie",
        res.provedor,
        res.mensagem ?? null,
        res.registros[0] ?? null,
        false,
      );

      return {
        registros: res.registros,
        provedor: res.provedor,
        ufEstabelecimento: res.uf_estabelecimento,
        mensagem: res.mensagem,
        doCache: false,
        consultadoEm: new Date().toISOString(),
      };
    },
    onSuccess: (r) => {
      setResultado(r);
      setEscolhido(r.registros[0]?.inscricao ?? null);
      if (r.registros.length === 0) {
        toast.info(r.mensagem ?? "Inscrição Estadual não localizada para este CNPJ.");
      } else if (r.registros.length > 1) {
        toast.success("Mais de um registro fiscal encontrado. Escolha o correto.");
      } else {
        toast.success(r.doCache ? "Dados fiscais do cache da última consulta" : "Consulta realizada com sucesso");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function aplicar(reg: RegistroFiscal) {
    const values: Record<string, string> = {
      inscricao_estadual: reg.inscricao,
      data_ultima_consulta_ie: new Date().toISOString(),
      ie_provedor: resultado?.provedor ?? "",
    };
    if (reg.uf) values["uf_inscricao_estadual"] = reg.uf;
    if (reg.situacao) values["situacao_inscricao_estadual"] = reg.situacao;
    if (reg.contribuinte_icms) values["indicador_contribuinte_icms"] = reg.contribuinte_icms;
    patch(values);
    toast.success("Dados fiscais preenchidos. Revise e salve para gravar.");
  }

  function registrarIsento() {
    patch({
      inscricao_estadual: "",
      indicador_contribuinte_icms: "ISENTO",
      situacao_inscricao_estadual: "NÃO CONTRIBUINTE",
      data_ultima_consulta_ie: new Date().toISOString(),
      ie_provedor: resultado?.provedor ?? "",
    });
    toast.success("Registrado como não contribuinte de ICMS.");
  }

  if (!pj) return null;

  const selecionado = resultado?.registros.find((r) => r.inscricao === escolhido) ?? null;
  const diferente =
    !!selecionado && !!ieAtual && digitos(ieAtual) !== digitos(selecionado.inscricao);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Dados fiscais — Inscrição Estadual</h3>
          <p className="text-xs text-muted-foreground">
            Busca a Inscrição Estadual do CNPJ informado. Nenhum dado comercial (limite, rota,
            vendedor, tabela de preço, condição de pagamento) é alterado.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={buscar.isPending || !canManage}
            onClick={() => buscar.mutate(false)}
          >
            {buscar.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Receipt className="size-3.5" />
            )}
            {ieAtual ? "Atualizar dados fiscais" : "Consultar IE"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={buscar.isPending || !canManage}
            onClick={() => buscar.mutate(true)}
          >
            <RefreshCw className="size-3.5" /> Consultar novamente
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">IE cadastrada</dt>
          <dd className="font-medium">{ieAtual ? formatarIe(ieAtual) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">UF da IE</dt>
          <dd className="font-medium">{String(form["uf_inscricao_estadual"] ?? "") || "—"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Situação</dt>
          <dd className="font-medium">
            {String(form["situacao_inscricao_estadual"] ?? "") || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Contribuinte ICMS</dt>
          <dd className="font-medium">
            {String(form["indicador_contribuinte_icms"] ?? "") || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Última consulta</dt>
          <dd className="font-medium">
            {form["data_ultima_consulta_ie"]
              ? new Date(String(form["data_ultima_consulta_ie"])).toLocaleString("pt-BR")
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Fonte</dt>
          <dd className="font-medium">{String(form["ie_provedor"] ?? "") || "—"}</dd>
        </div>
      </dl>

      {resultado ? (
        <div className="space-y-2 rounded-md border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">
            Fonte: {resultado.provedor}
            {resultado.doCache ? " (cache)" : ""} · consultado em{" "}
            {new Date(resultado.consultadoEm).toLocaleString("pt-BR")}
            {resultado.ufEstabelecimento ? ` · UF do estabelecimento: ${resultado.ufEstabelecimento}` : ""}
          </p>

          {resultado.registros.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm">
                {resultado.mensagem ?? "Inscrição Estadual não localizada para este CNPJ."}
              </p>
              <p className="text-xs text-muted-foreground">
                Nenhum campo foi alterado. Registre como não contribuinte apenas se isso for
                confirmado.
              </p>
              <Button size="sm" variant="outline" onClick={registrarIsento}>
                Registrar como não contribuinte de ICMS
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {resultado.registros.map((r) => (
                <label
                  key={r.inscricao}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-2 text-xs"
                >
                  <input
                    type="radio"
                    name="registro-fiscal"
                    className="size-4 accent-primary"
                    checked={escolhido === r.inscricao}
                    onChange={() => setEscolhido(r.inscricao)}
                  />
                  <span className="font-medium">{formatarIe(r.inscricao)}</span>
                  <span className="text-muted-foreground">
                    {[r.uf, r.situacao, r.contribuinte_icms ? `ICMS: ${r.contribuinte_icms}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </label>
              ))}

              {diferente ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                  <p className="font-medium">
                    A Inscrição Estadual encontrada é diferente da cadastrada atualmente. Deseja
                    atualizar?
                  </p>
                  <p className="mt-1">Atual: {formatarIe(ieAtual)}</p>
                  <p>Encontrada: {formatarIe(selecionado!.inscricao)}</p>
                </div>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setResultado(null)}>
                  {diferente ? "Manter atual" : "Descartar consulta"}
                </Button>
                <Button size="sm" disabled={!selecionado} onClick={() => aplicar(selecionado!)}>
                  {diferente ? "Atualizar" : "Usar estes dados fiscais"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {(historico.data ?? []).length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Histórico de consultas fiscais deste CNPJ</summary>
          <ul className="mt-2 space-y-1">
            {(historico.data ?? []).map((h, i) => (
              <li key={i}>
                {new Date(String(h["created_at"])).toLocaleString("pt-BR")} ·{" "}
                {String(h["provedor"] ?? "—")} · {String(h["resultado"])}
                {h["inscricao_estadual"] ? ` · IE ${String(h["inscricao_estadual"])}` : ""}
                {h["uf_inscricao"] ? ` (${String(h["uf_inscricao"])})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
