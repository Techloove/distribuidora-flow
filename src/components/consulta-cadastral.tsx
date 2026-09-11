import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  consultarDocumento,
  type ConsultaResultado,
  type DadosCadastrais,
} from "@/lib/consulta-cadastral.functions";
import { useSupabase } from "@/lib/supabase-provider";

type Row = Record<string, unknown>;

/** Campos cadastrais preenchidos pela consulta. Dados comerciais nunca entram aqui. */
const CAMPOS: { name: keyof DadosCadastrais; label: string }[] = [
  { name: "cnpj_cpf", label: "CNPJ / CPF" },
  { name: "razao_social", label: "Razão social / Nome" },
  { name: "nome_fantasia", label: "Nome fantasia" },
  { name: "situacao_cadastral", label: "Situação cadastral" },
  { name: "data_abertura", label: "Data de abertura" },
  { name: "data_nascimento", label: "Data de nascimento" },
  { name: "natureza_juridica", label: "Natureza jurídica" },
  { name: "porte", label: "Porte" },
  { name: "cnae_principal", label: "CNAE principal" },
  { name: "cnae_secundarios", label: "CNAEs secundários" },
  { name: "inscricao_estadual", label: "Inscrição estadual" },
  { name: "cep", label: "CEP" },
  { name: "logradouro", label: "Logradouro" },
  { name: "numero", label: "Número" },
  { name: "complemento", label: "Complemento" },
  { name: "bairro", label: "Bairro" },
  { name: "cidade", label: "Município" },
  { name: "uf", label: "UF" },
  { name: "telefone", label: "Telefone" },
  { name: "email", label: "E-mail" },
];

const digitos = (v: string) => (v ?? "").replace(/\D+/g, "");

const formatarDoc = (v: string) => {
  const d = digitos(v);
  if (d.length === 14)
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v;
};

/**
 * Consulta cadastral dentro do cadastro de clientes já existente.
 * Usa a camada de serviço no servidor (a chave da API fica no backend),
 * guarda cache e histórico e nunca sobrescreve dados comerciais.
 */
export function ConsultaCadastral({
  form,
  editing,
  patch,
  openRow,
}: {
  form: Record<string, string | boolean>;
  editing: Row | null;
  patch: (values: Record<string, string>) => void;
  openRow: (row: Row) => void;
}) {
  const { client, canManage } = useSupabase();
  const queryClient = useQueryClient();
  const consultar = useServerFn(consultarDocumento);
  const [resultado, setResultado] = useState<
    | null
    | {
        dados: DadosCadastrais;
        provedor: string;
        tipo: "PJ" | "PF";
        doCache: boolean;
        consultadoEm: string;
      }
  >(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const documento = String(form["cnpj_cpf"] ?? "");
  const doc = digitos(documento);
  const editandoId = editing ? String(editing["id"]) : null;

  /** Duplicidade: mesmo documento já cadastrado em outro cliente. */
  const duplicado = useQuery({
    queryKey: ["cliente_por_documento", doc],
    enabled: !!client && (doc.length === 11 || doc.length === 14),
    queryFn: async () => {
      const { data, error } = await client!.rpc("cliente_por_documento", { _documento: doc });
      if (error) return [] as Row[];
      return ((data ?? []) as Row[]).filter((r) => String(r["id"]) !== editandoId);
    },
  });

  /** Últimas consultas do documento (histórico). */
  const historico = useQuery({
    queryKey: ["consultas_log", doc],
    enabled: !!client && doc.length >= 11,
    queryFn: async () => {
      const { data, error } = await client!
        .from("consultas_log")
        .select("created_at, provedor, resultado, mensagem, origem_cache")
        .eq("documento", doc)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) return [] as Row[];
      return (data ?? []) as Row[];
    },
  });

  async function registrar(
    resultadoTexto: string,
    provedor: string | null,
    tipo: string | null,
    mensagem: string | null,
    doCache: boolean,
  ) {
    if (!client) return;
    await client.from("consultas_log").insert({
      documento: doc,
      tipo,
      provedor,
      resultado: resultadoTexto,
      mensagem,
      cliente_id: editandoId,
      origem_cache: doCache,
    });
    queryClient.invalidateQueries({ queryKey: ["consultas_log", doc] });
  }

  const buscar = useMutation({
    mutationFn: async (forcar: boolean) => {
      if (!client) throw new Error("Sessão indisponível. Entre novamente.");
      if (doc.length !== 11 && doc.length !== 14) {
        throw new Error("Informe um CNPJ com 14 números ou um CPF com 11 números.");
      }

      // 1) cache válido evita consulta paga/desnecessária
      if (!forcar) {
        const { data: cache } = await client
          .from("consultas_cadastrais")
          .select("documento, tipo, provedor, dados, consultado_em, expira_em")
          .eq("documento", doc)
          .gt("expira_em", new Date().toISOString())
          .maybeSingle();
        if (cache) {
          await registrar("cache", String(cache["provedor"]), String(cache["tipo"]), null, true);
          return {
            dados: (cache["dados"] ?? {}) as DadosCadastrais,
            provedor: String(cache["provedor"]),
            tipo: String(cache["tipo"]) as "PJ" | "PF",
            doCache: true,
            consultadoEm: String(cache["consultado_em"]),
          };
        }
      }

      // 2) provedor externo, sempre pelo servidor
      const res = (await consultar({ data: { documento: doc } })) as ConsultaResultado;
      if (!res.ok) {
        await registrar(res.codigo, null, res.tipo, res.mensagem, false);
        throw new Error(res.mensagem);
      }

      await client.from("consultas_cadastrais").upsert(
        {
          documento: res.documento,
          tipo: res.tipo,
          provedor: res.provedor,
          dados: res.dados,
          consultado_em: new Date().toISOString(),
          expira_em: new Date(Date.now() + res.validadeDias * 86400000).toISOString(),
        },
        { onConflict: "documento" },
      );
      await registrar("sucesso", res.provedor, res.tipo, null, false);

      return {
        dados: res.dados,
        provedor: res.provedor,
        tipo: res.tipo,
        doCache: false,
        consultadoEm: new Date().toISOString(),
      };
    },
    onSuccess: (r) => {
      setResultado(r);
      const mudou = CAMPOS.filter((c) => {
        const novo = String(r.dados[c.name] ?? "").trim();
        if (!novo) return false;
        return novo !== String(form[c.name] ?? "").trim();
      }).map((c) => String(c.name));
      setSelecionados(new Set(mudou));
      toast.success(
        r.doCache
          ? "Dados carregados do cache da última consulta"
          : "Consulta realizada com sucesso",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function aplicar() {
    if (!resultado) return;
    const values: Record<string, string> = {};
    for (const campo of CAMPOS) {
      const nome = String(campo.name);
      if (!selecionados.has(nome)) continue;
      const novo = String(resultado.dados[campo.name] ?? "").trim();
      if (!novo) continue;
      values[nome] = nome === "cnpj_cpf" ? formatarDoc(novo) : novo;
    }
    if (Object.keys(values).length === 0) {
      toast.info("Nenhum campo selecionado para atualizar.");
      return;
    }
    values["tipo_pessoa"] = resultado.tipo;
    values["cadastro_provedor"] = resultado.provedor;
    values["cadastro_consultado_em"] = resultado.consultadoEm;
    values["cadastro_atualizado_em"] = new Date().toISOString();
    patch(values);
    toast.success("Cadastro preenchido. Revise e salve para gravar.");
  }

  async function abrirExistente(id: string) {
    if (!client) return;
    const { data, error } = await client.from("clientes").select("*").eq("id", id).maybeSingle();
    if (error || !data) {
      toast.error("Não foi possível abrir o cliente.");
      return;
    }
    setResultado(null);
    openRow(data as Row);
  }

  const linhas = resultado
    ? CAMPOS.filter((c) => String(resultado.dados[c.name] ?? "").trim() !== "")
    : [];

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Consulta cadastral (CNPJ / CPF)</h3>
          <p className="text-xs text-muted-foreground">
            Busca os dados na fonte oficial e preenche apenas os campos cadastrais. Limite de
            crédito, rota, tabela de preço e demais dados comerciais não são alterados.
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
              <Search className="size-3.5" />
            )}
            {editing ? "Atualizar dados cadastrais" : "Consultar dados"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={buscar.isPending || !canManage}
            onClick={() => buscar.mutate(true)}
          >
            <RefreshCw className="size-3.5" /> Atualizar consulta
          </Button>
        </div>
      </div>

      {(duplicado.data ?? []).length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive">Este documento já está cadastrado.</p>
          <ul className="mt-2 space-y-1">
            {(duplicado.data ?? []).map((c) => (
              <li key={String(c["id"])} className="flex items-center justify-between gap-2">
                <span className="text-xs">
                  {String(c["codigo"] ?? "—")} · {String(c["razao_social"] ?? "")} ·{" "}
                  {String(c["cnpj_cpf"] ?? "")}
                </span>
                <Button size="sm" variant="ghost" onClick={() => abrirExistente(String(c["id"]))}>
                  Abrir cadastro
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {resultado ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Fonte: {resultado.provedor}
            {resultado.doCache ? " (cache)" : ""} · consultado em{" "}
            {new Date(resultado.consultadoEm).toLocaleString("pt-BR")}. Marque o que deseja
            substituir e confirme.
          </p>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"> </TableHead>
                  <TableHead>Campo</TableHead>
                  <TableHead>Atual</TableHead>
                  <TableHead>Consultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((c) => {
                  const nome = String(c.name);
                  const atual = String(form[nome] ?? "").trim();
                  const novo = String(resultado.dados[c.name] ?? "").trim();
                  const diferente = atual !== novo;
                  return (
                    <TableRow key={nome} className={diferente ? "" : "opacity-60"}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Usar ${c.label}`}
                          className="size-4 accent-primary"
                          checked={selecionados.has(nome)}
                          onChange={(e) =>
                            setSelecionados((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.add(nome);
                              else next.delete(nome);
                              return next;
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-xs font-medium">{c.label}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {atual || "—"}
                      </TableCell>
                      <TableCell className="text-xs">{novo}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setResultado(null)}>
              Descartar consulta
            </Button>
            <Button size="sm" onClick={aplicar}>
              Confirmar e preencher cadastro
            </Button>
          </div>
        </div>
      ) : null}

      {(historico.data ?? []).length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Histórico de consultas deste documento</summary>
          <ul className="mt-2 space-y-1">
            {(historico.data ?? []).map((h, i) => (
              <li key={i}>
                {new Date(String(h["created_at"])).toLocaleString("pt-BR")} ·{" "}
                {String(h["provedor"] ?? "—")} · {String(h["resultado"])}
                {h["origem_cache"] ? " (cache)" : ""}
                {h["mensagem"] ? ` · ${String(h["mensagem"])}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
