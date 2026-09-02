import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";

type Row = Record<string, unknown>;

const PERIODOS = [
  { value: "mensal", label: "Mensal" },
  { value: "semanal", label: "Semanal" },
  { value: "pedido", label: "Por pedido" },
  { value: "faturamento", label: "Por faturamento" },
  { value: "recebimento", label: "Por recebimento" },
];

const BASES = [
  { value: "bruto", label: "Valor bruto" },
  { value: "liquido", label: "Valor líquido" },
  { value: "apos_desconto", label: "Após descontos" },
];

function num(v: unknown) {
  return v === null || v === undefined || v === "" ? "" : String(v);
}

/** Configuração de comissão do representante, dentro do cadastro unificado. */
export function ComissaoRepresentante({ representanteId }: { representanteId: string | null }) {
  const { client, canManage } = useSupabase();
  const queryClient = useQueryClient();
  const [novaRegra, setNovaRegra] = useState<Record<string, string>>({});
  const [novaFaixa, setNovaFaixa] = useState<Record<string, string>>({});

  const enabled = !!client && !!representanteId;

  const regras = useQuery({
    queryKey: ["regras_comissao", representanteId],
    enabled,
    queryFn: async () => {
      const { data, error } = await client!
        .from("regras_comissao")
        .select("*")
        .eq("representante_id", representanteId)
        .order("prioridade", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const faixas = useQuery({
    queryKey: ["comissao_faixas", representanteId],
    enabled,
    queryFn: async () => {
      const { data, error } = await client!
        .from("comissao_faixas")
        .select("*")
        .eq("representante_id", representanteId)
        .order("valor_min");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  function invalidate(table: string) {
    queryClient.invalidateQueries({ queryKey: [table] });
  }

  const gravar = useMutation({
    mutationFn: async ({
      table,
      id,
      patch,
    }: {
      table: string;
      id?: string;
      patch: Record<string, unknown>;
    }) => {
      if (id) {
        const { error } = await client!.from(table).update(patch).eq("id", id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await client!
          .from(table)
          .insert({ ...patch, representante_id: representanteId });
        if (error) throw new Error(error.message);
      }
      return table;
    },
    onSuccess: (table) => {
      toast.success("Comissão atualizada");
      invalidate(table);
      if (table === "regras_comissao") setNovaRegra({});
      else setNovaFaixa({});
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async ({ table, id }: { table: string; id: string }) => {
      const { error } = await client!.from(table).delete().eq("id", id);
      if (error) throw new Error(error.message);
      return table;
    },
    onSuccess: (table) => {
      toast.success("Registro excluído");
      invalidate(table);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!representanteId) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        Marque <strong>Representante</strong> e salve o cadastro para configurar as regras e as
        faixas de comissão deste representante aqui mesmo.
      </div>
    );
  }

  const carregando = regras.isLoading || faixas.isLoading;

  return (
    <div className="space-y-6 rounded-lg border border-border bg-muted/30 p-4">
      <div>
        <h3 className="text-sm font-semibold">Comissão do representante</h3>
        <p className="text-xs text-muted-foreground">
          Ordem de aplicação no pedido: percentual do produto → regra específica → faixa
          escalonada.
        </p>
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </div>
      ) : null}

      {/* ---- regras ---- */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">
          Regras de comissão
        </h4>
        {(regras.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma regra específica cadastrada.</p>
        ) : null}
        {(regras.data ?? []).map((r) => (
          <div key={String(r["id"])} className="grid gap-2 sm:grid-cols-12">
            <Input
              className="sm:col-span-4"
              aria-label="Nome da regra"
              defaultValue={num(r["nome"])}
              disabled={!canManage}
              onBlur={(e) =>
                e.target.value !== num(r["nome"]) &&
                gravar.mutate({
                  table: "regras_comissao",
                  id: String(r["id"]),
                  patch: { nome: e.target.value },
                })
              }
            />
            <Input
              className="sm:col-span-2"
              aria-label="UF"
              placeholder="UF"
              defaultValue={num(r["uf"])}
              disabled={!canManage}
              onBlur={(e) =>
                e.target.value !== num(r["uf"]) &&
                gravar.mutate({
                  table: "regras_comissao",
                  id: String(r["id"]),
                  patch: { uf: e.target.value || null },
                })
              }
            />
            <Input
              className="sm:col-span-2"
              type="number"
              step="0.01"
              aria-label="Percentual"
              defaultValue={num(r["percentual"])}
              disabled={!canManage}
              onBlur={(e) =>
                e.target.value !== num(r["percentual"]) &&
                gravar.mutate({
                  table: "regras_comissao",
                  id: String(r["id"]),
                  patch: { percentual: e.target.value === "" ? 0 : Number(e.target.value) },
                })
              }
            />
            <Input
              className="sm:col-span-2"
              type="number"
              aria-label="Prioridade"
              defaultValue={num(r["prioridade"])}
              disabled={!canManage}
              onBlur={(e) =>
                e.target.value !== num(r["prioridade"]) &&
                gravar.mutate({
                  table: "regras_comissao",
                  id: String(r["id"]),
                  patch: { prioridade: e.target.value === "" ? 0 : Number(e.target.value) },
                })
              }
            />
            <div className="flex items-center gap-2 sm:col-span-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  defaultChecked={Boolean(r["ativo"])}
                  disabled={!canManage}
                  onChange={(e) =>
                    gravar.mutate({
                      table: "regras_comissao",
                      id: String(r["id"]),
                      patch: { ativo: e.target.checked },
                    })
                  }
                />
                Ativa
              </label>
              <Button
                variant="ghost"
                size="icon"
                disabled={!canManage}
                onClick={() => excluir.mutate({ table: "regras_comissao", id: String(r["id"]) })}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}

        <div className="grid gap-2 sm:grid-cols-12">
          <div className="space-y-1 sm:col-span-4">
            <Label className="text-xs">Nova regra</Label>
            <Input
              placeholder="Nome"
              value={novaRegra["nome"] ?? ""}
              onChange={(e) => setNovaRegra((s) => ({ ...s, nome: e.target.value }))}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">UF</Label>
            <Input
              value={novaRegra["uf"] ?? ""}
              onChange={(e) => setNovaRegra((s) => ({ ...s, uf: e.target.value }))}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">%</Label>
            <Input
              type="number"
              step="0.01"
              value={novaRegra["percentual"] ?? ""}
              onChange={(e) => setNovaRegra((s) => ({ ...s, percentual: e.target.value }))}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Prioridade</Label>
            <Input
              type="number"
              value={novaRegra["prioridade"] ?? ""}
              onChange={(e) => setNovaRegra((s) => ({ ...s, prioridade: e.target.value }))}
            />
          </div>
          <div className="flex items-end sm:col-span-2">
            <Button
              variant="secondary"
              disabled={!canManage || !novaRegra["nome"]}
              onClick={() =>
                gravar.mutate({
                  table: "regras_comissao",
                  patch: {
                    nome: novaRegra["nome"],
                    uf: novaRegra["uf"] || null,
                    percentual: Number(novaRegra["percentual"] ?? 0),
                    prioridade: Number(novaRegra["prioridade"] ?? 0),
                    ativo: true,
                  },
                })
              }
            >
              <Plus className="size-4" />
              Adicionar
            </Button>
          </div>
        </div>
      </section>

      {/* ---- faixas ---- */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">
          Comissão escalonada por volume
        </h4>
        {(faixas.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma faixa cadastrada.</p>
        ) : null}
        {(faixas.data ?? []).map((r) => (
          <div key={String(r["id"])} className="grid gap-2 sm:grid-cols-12">
            <Input
              className="sm:col-span-3"
              aria-label="Nome da faixa"
              defaultValue={num(r["nome"])}
              disabled={!canManage}
              onBlur={(e) =>
                e.target.value !== num(r["nome"]) &&
                gravar.mutate({
                  table: "comissao_faixas",
                  id: String(r["id"]),
                  patch: { nome: e.target.value },
                })
              }
            />
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm sm:col-span-2"
              aria-label="Apuração"
              defaultValue={num(r["periodo"])}
              disabled={!canManage}
              onChange={(e) =>
                gravar.mutate({
                  table: "comissao_faixas",
                  id: String(r["id"]),
                  patch: { periodo: e.target.value },
                })
              }
            >
              {PERIODOS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm sm:col-span-2"
              aria-label="Base de cálculo"
              defaultValue={num(r["base_calculo"])}
              disabled={!canManage}
              onChange={(e) =>
                gravar.mutate({
                  table: "comissao_faixas",
                  id: String(r["id"]),
                  patch: { base_calculo: e.target.value },
                })
              }
            >
              {BASES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
            <Input
              className="sm:col-span-2"
              type="number"
              step="0.01"
              aria-label="De (R$)"
              defaultValue={num(r["valor_min"])}
              disabled={!canManage}
              onBlur={(e) =>
                e.target.value !== num(r["valor_min"]) &&
                gravar.mutate({
                  table: "comissao_faixas",
                  id: String(r["id"]),
                  patch: { valor_min: e.target.value === "" ? 0 : Number(e.target.value) },
                })
              }
            />
            <Input
              className="sm:col-span-1"
              type="number"
              step="0.01"
              aria-label="Até (R$)"
              defaultValue={num(r["valor_max"])}
              disabled={!canManage}
              onBlur={(e) =>
                e.target.value !== num(r["valor_max"]) &&
                gravar.mutate({
                  table: "comissao_faixas",
                  id: String(r["id"]),
                  patch: { valor_max: e.target.value === "" ? null : Number(e.target.value) },
                })
              }
            />
            <Input
              className="sm:col-span-1"
              type="number"
              step="0.01"
              aria-label="Comissão (%)"
              defaultValue={num(r["percentual"])}
              disabled={!canManage}
              onBlur={(e) =>
                e.target.value !== num(r["percentual"]) &&
                gravar.mutate({
                  table: "comissao_faixas",
                  id: String(r["id"]),
                  patch: { percentual: e.target.value === "" ? 0 : Number(e.target.value) },
                })
              }
            />
            <div className="flex items-center gap-2 sm:col-span-1">
              <Button
                variant="ghost"
                size="icon"
                disabled={!canManage}
                onClick={() => excluir.mutate({ table: "comissao_faixas", id: String(r["id"]) })}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}

        <div className="grid gap-2 sm:grid-cols-12">
          <div className="space-y-1 sm:col-span-3">
            <Label className="text-xs">Nova faixa</Label>
            <Input
              placeholder="Nome"
              value={novaFaixa["nome"] ?? ""}
              onChange={(e) => setNovaFaixa((s) => ({ ...s, nome: e.target.value }))}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Apuração</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={novaFaixa["periodo"] ?? "mensal"}
              onChange={(e) => setNovaFaixa((s) => ({ ...s, periodo: e.target.value }))}
            >
              {PERIODOS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Base</Label>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={novaFaixa["base_calculo"] ?? "liquido"}
              onChange={(e) => setNovaFaixa((s) => ({ ...s, base_calculo: e.target.value }))}
            >
              {BASES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">De (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={novaFaixa["valor_min"] ?? ""}
              onChange={(e) => setNovaFaixa((s) => ({ ...s, valor_min: e.target.value }))}
            />
          </div>
          <div className="space-y-1 sm:col-span-1">
            <Label className="text-xs">Até</Label>
            <Input
              type="number"
              step="0.01"
              value={novaFaixa["valor_max"] ?? ""}
              onChange={(e) => setNovaFaixa((s) => ({ ...s, valor_max: e.target.value }))}
            />
          </div>
          <div className="space-y-1 sm:col-span-1">
            <Label className="text-xs">%</Label>
            <Input
              type="number"
              step="0.01"
              value={novaFaixa["percentual"] ?? ""}
              onChange={(e) => setNovaFaixa((s) => ({ ...s, percentual: e.target.value }))}
            />
          </div>
          <div className="flex items-end sm:col-span-1">
            <Button
              variant="secondary"
              size="icon"
              disabled={!canManage || !novaFaixa["nome"]}
              aria-label="Adicionar faixa"
              onClick={() =>
                gravar.mutate({
                  table: "comissao_faixas",
                  patch: {
                    nome: novaFaixa["nome"],
                    periodo: novaFaixa["periodo"] ?? "mensal",
                    base_calculo: novaFaixa["base_calculo"] ?? "liquido",
                    valor_min: Number(novaFaixa["valor_min"] ?? 0),
                    valor_max:
                      novaFaixa["valor_max"] === "" || novaFaixa["valor_max"] === undefined
                        ? null
                        : Number(novaFaixa["valor_max"]),
                    percentual: Number(novaFaixa["percentual"] ?? 0),
                    ativo: true,
                  },
                })
              }
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
