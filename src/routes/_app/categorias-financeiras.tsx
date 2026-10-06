import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Loader2, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ErpLayout } from "@/components/erp-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSupabase } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/categorias-financeiras")({
  head: () => ({
    meta: [
      { title: "Categorias financeiras — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Cadastro de categorias e subcategorias de receitas e despesas usadas no financeiro e na DRE.",
      },
      { property: "og:title", content: "Categorias financeiras — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Categorias e subcategorias de despesas e receitas com grupo de DRE.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CategoriasFinanceirasPage,
});

const grupos = [
  { value: "receita_bruta", label: "Receita bruta" },
  { value: "deducao", label: "Deduções" },
  { value: "cpv", label: "Custo dos produtos vendidos" },
  { value: "despesa_administrativa", label: "Despesas administrativas" },
  { value: "despesa_comercial", label: "Despesas comerciais" },
  { value: "despesa_vendas", label: "Despesas com vendas" },
  { value: "despesa_logistica", label: "Despesas de logística" },
  { value: "despesa_operacional", label: "Outras despesas operacionais" },
  { value: "despesa_financeira", label: "Despesas financeiras" },
  { value: "receita_financeira", label: "Receitas financeiras" },
  { value: "outras", label: "Outras" },
];

type Cat = {
  id: string;
  nome: string;
  tipo: string;
  parent_id: string | null;
  grupo_dre: string;
  ordem: number;
  ativo: boolean;
};

const selectCls =
  "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground";

function CategoriasFinanceirasPage() {
  const { client } = useSupabase();
  const qc = useQueryClient();
  const [tipo, setTipo] = useState("despesa");
  const [novo, setNovo] = useState("");
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});

  const lista = useQuery({
    queryKey: ["categorias_financeiras", "arvore"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("categorias_financeiras")
        .select("id, nome, tipo, parent_id, grupo_dre, ordem, ativo")
        .order("ordem")
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Cat[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["categorias_financeiras"] });

  const salvar = useMutation({
    mutationFn: async (a: { id?: string; values: Partial<Cat> }) => {
      const q = a.id
        ? client!.from("categorias_financeiras").update(a.values).eq("id", a.id)
        : client!.from("categorias_financeiras").insert(a.values);
      const { error } = await q;
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.from("categorias_financeiras").delete().eq("id", id);
      if (error) {
        const r = await client!.from("categorias_financeiras").update({ ativo: false }).eq("id", id);
        if (r.error) throw new Error(r.error.message);
        return "inativada";
      }
      return "excluida";
    },
    onSuccess: (r) => {
      toast.success(r === "inativada" ? "Categoria em uso: foi inativada." : "Excluída.");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { pais, filhos } = useMemo(() => {
    const all = (lista.data ?? []).filter((c) => c.tipo === tipo);
    const filhos = new Map<string, Cat[]>();
    for (const c of all) {
      if (!c.parent_id) continue;
      filhos.set(c.parent_id, [...(filhos.get(c.parent_id) ?? []), c]);
    }
    return { pais: all.filter((c) => !c.parent_id), filhos };
  }, [lista.data, tipo]);

  function criarCategoria() {
    const nome = novo.trim();
    if (!nome) return;
    salvar.mutate(
      {
        values: {
          nome,
          tipo,
          grupo_dre: tipo === "receita" ? "receita_bruta" : "despesa_operacional",
        },
      },
      { onSuccess: () => setNovo("") },
    );
  }

  return (
    <ErpLayout
      title="Categorias financeiras"
      description="Categorias e subcategorias usadas em contas a pagar, receber, movimentações e DRE."
    >
      <div className="mx-auto max-w-5xl space-y-4">
        <Tabs value={tipo} onValueChange={setTipo}>
          <TabsList>
            <TabsTrigger value="despesa">Despesas</TabsTrigger>
            <TabsTrigger value="receita">Receitas</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">
            Gerenciar categorias de {tipo === "despesa" ? "saída" : "entrada"}
          </h2>

          {lista.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : pais.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma categoria ainda. Crie a primeira abaixo.
            </p>
          ) : (
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {pais.map((p) => (
                <CategoriaCard
                  key={p.id}
                  cat={p}
                  subs={filhos.get(p.id) ?? []}
                  aberta={!!abertas[p.id]}
                  onToggle={() => setAbertas((s) => ({ ...s, [p.id]: !s[p.id] }))}
                  onSave={(id, values) => salvar.mutate({ id, values })}
                  onAddSub={(nome) =>
                    salvar.mutate({
                      values: { nome, tipo, parent_id: p.id, grupo_dre: p.grupo_dre },
                    })
                  }
                  onDelete={(id, nome) => {
                    if (confirm(`Excluir "${nome}"?`)) excluir.mutate(id);
                  }}
                />
              ))}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <Input
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && criarCategoria()}
              placeholder="Nome da categoria..."
              className="h-10"
            />
            <Button className="h-10 px-6" onClick={criarCategoria} disabled={salvar.isPending}>
              Criar
            </Button>
          </div>
        </div>
      </div>
    </ErpLayout>
  );
}

function CategoriaCard({
  cat,
  subs,
  aberta,
  onToggle,
  onSave,
  onAddSub,
  onDelete,
}: {
  cat: Cat;
  subs: Cat[];
  aberta: boolean;
  onToggle: () => void;
  onSave: (id: string, values: Partial<Cat>) => void;
  onAddSub: (nome: string) => void;
  onDelete: (id: string, nome: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(cat.nome);
  const [sub, setSub] = useState("");
  const [editSub, setEditSub] = useState<{ id: string; nome: string } | null>(null);

  const addSub = () => {
    const n = sub.trim();
    if (!n) return;
    onAddSub(n);
    setSub("");
  };

  return (
    <div
      className={`rounded-lg border border-border bg-muted/40 p-3 ${cat.ativo ? "" : "opacity-60"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {editando ? (
          <div className="flex flex-1 items-center gap-1">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} className="h-8" autoFocus />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                if (nome.trim()) onSave(cat.id, { nome: nome.trim() });
                setEditando(false);
              }}
            >
              <Check className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setEditando(false)}>
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <p className="flex-1 font-medium">
            {cat.nome}
            {!cat.ativo ? <span className="ml-2 text-xs text-muted-foreground">(inativa)</span> : null}
          </p>
        )}
        <select
          className={selectCls}
          value={cat.grupo_dre}
          title="Grupo na DRE"
          onChange={(e) => onSave(cat.id, { grupo_dre: e.target.value })}
        >
          {grupos.map((g) => (
            <option key={g.value} value={g.value}>
              DRE: {g.label}
            </option>
          ))}
        </select>
        <Button size="sm" variant="ghost" onClick={onToggle}>
          <Settings2 className="size-4" /> Sub ({subs.length})
        </Button>
        <Button size="icon" variant="ghost" onClick={() => setEditando(true)} title="Renomear">
          <Pencil className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="text-destructive"
          onClick={() => onDelete(cat.id, cat.nome)}
          title="Excluir"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {subs.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {subs.map((s) =>
            editSub?.id === s.id ? (
              <span key={s.id} className="flex items-center gap-1">
                <Input
                  value={editSub.nome}
                  onChange={(e) => setEditSub({ id: s.id, nome: e.target.value })}
                  className="h-7 w-40 text-xs"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && editSub.nome.trim()) {
                      onSave(s.id, { nome: editSub.nome.trim() });
                      setEditSub(null);
                    }
                  }}
                />
                <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditSub(null)}>
                  <X className="size-3" />
                </Button>
              </span>
            ) : (
              <span
                key={s.id}
                className={`group inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary ${s.ativo ? "" : "line-through opacity-60"}`}
              >
                {s.nome}
                {aberta ? (
                  <>
                    <button onClick={() => setEditSub({ id: s.id, nome: s.nome })} title="Renomear">
                      <Pencil className="size-3" />
                    </button>
                    <button onClick={() => onDelete(s.id, s.nome)} title="Excluir" className="text-destructive">
                      <X className="size-3" />
                    </button>
                  </>
                ) : null}
              </span>
            ),
          )}
        </div>
      ) : null}

      {aberta ? (
        <div className="mt-2 flex gap-2">
          <Input
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSub()}
            placeholder="Nova subcategoria..."
            className="h-8 text-sm"
          />
          <Button size="sm" onClick={addSub}>
            <Plus className="size-4" /> Adicionar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
