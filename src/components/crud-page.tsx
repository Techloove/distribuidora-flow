import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCentro } from "@/lib/centro-store";
import { useSupabase } from "@/lib/supabase-provider";

export type FieldType =
  | "text"
  | "email"
  | "number"
  | "date"
  | "select"
  | "checkbox"
  | "multicheck"
  | "ref";

export type CrudField = {
  name: string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  /** Colunas booleanas exibidas como grupo de caixas de seleção (type: "multicheck"). */
  checks?: { name: string; label: string }[];
  /** Seleção de registro relacionado (type: "ref"). */
  ref?: { table: string; labelField: string };
  required?: boolean;
  step?: string;
  inTable?: boolean;
  span?: 1 | 2;
  /** Campo gerado pelo banco (ex.: código sequencial): somente leitura e não enviado. */
  auto?: boolean;
};

/** Opções de um campo de referência (FK). */
function useRefOptions(field: CrudField) {
  const { client } = useSupabase();
  const ref = field.ref;
  return useQuery({
    queryKey: ["ref", ref?.table],
    enabled: !!client && !!ref,
    queryFn: async () => {
      const { data, error } = await client!
        .from(ref!.table)
        .select(`id, ${ref!.labelField}`)
        .order(ref!.labelField);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown) as Record<string, unknown>[];
    },
  });
}

function RefSelect({
  field,
  value,
  onChange,
}: {
  field: CrudField;
  value: string;
  onChange: (v: string) => void;
}) {
  const options = useRefOptions(field);
  return (
    <select
      id={field.name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
    >
      <option value="">—</option>
      {(options.data ?? []).map((o) => (
        <option key={String(o["id"])} value={String(o["id"])}>
          {String(o[field.ref!.labelField] ?? "")}
        </option>
      ))}
    </select>
  );
}


export type Row = Record<string, unknown>;

export function CrudPage({
  table,
  fields,
  orderBy,
  emptyLabel,
  searchColumns,
}: {
  table: string;
  fields: CrudField[];
  orderBy: string;
  emptyLabel: string;
  searchColumns: string[];
}) {
  const { client, canManage } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: [table],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from(table).select("*").order(orderBy);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const rows = useMemo(() => {
    let list = query.data ?? [];
    if (centro && list.some((r) => "centro_id" in r)) {
      list = list.filter((r) => !r["centro_id"] || r["centro_id"] === centro);
    }
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((row) =>
      searchColumns.some((col) => String(row[col] ?? "").toLowerCase().includes(term)),
    );
  }, [query.data, search, searchColumns, centro]);

  function openCreate() {
    setEditing(null);
    const next: Record<string, string | boolean> = {};
    for (const f of fields) {
      if (f.type === "multicheck") {
        for (const c of f.checks ?? []) next[c.name] = false;
      } else {
        next[f.name] = f.type === "checkbox" ? true : "";
      }
    }
    setForm(next);
    setOpen(true);
  }

  function openEdit(row: Row) {
    setEditing(row);
    const next: Record<string, string | boolean> = {};
    for (const f of fields) {
      if (f.type === "multicheck") {
        for (const c of f.checks ?? []) next[c.name] = Boolean(row[c.name]);
      } else {
        next[f.name] = f.type === "checkbox" ? Boolean(row[f.name]) : String(row[f.name] ?? "");
      }
    }
    setForm(next);
    setOpen(true);
  }


  function traduzErro(message: string) {
    if (/row-level security|violates row-level/i.test(message)) {
      return "Seu usuário não tem permissão para gravar aqui. É necessário o papel admin ou gestor (tela Usuários e papéis).";
    }
    if (/duplicate key|already exists/i.test(message)) {
      return "Já existe um registro com esse código/documento.";
    }
    if (/permission denied/i.test(message)) {
      return "Permissão negada pelo banco de dados. Verifique se o SQL das fases foi executado por completo.";
    }
    if (/violates foreign key/i.test(message)) {
      return "Há um vínculo inválido: selecione um registro relacionado existente.";
    }
    if (/not-null|null value in column/i.test(message)) {
      return "Preencha todos os campos obrigatórios.";
    }
    return message;
  }

  const save = useMutation({

    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      for (const field of fields) {
        if (field.auto) continue;
        if (field.type === "multicheck") {
          for (const c of field.checks ?? []) payload[c.name] = Boolean(form[c.name]);
          continue;
        }
        const raw = form[field.name];
        if (field.type === "checkbox") {
          payload[field.name] = Boolean(raw);
        } else if (field.type === "number") {
          payload[field.name] = raw === "" ? null : Number(raw);
        } else {
          payload[field.name] = raw === "" ? null : raw;
        }
      }

      if (editing) {
        const { error } = await client!
          .from(table)
          .update(payload)
          .eq("id", editing["id"] as string);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await client!.from(table).insert(payload);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Registro atualizado" : "Registro criado");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: [table] });
    },
    onError: (error: Error) => toast.error(traduzErro(error.message)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client!.from(table).delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Registro excluído");
      queryClient.invalidateQueries({ queryKey: [table] });
    },
    onError: (error: Error) => toast.error(traduzErro(error.message)),
  });

  const tableFields = fields.filter((f) => f.inTable);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          placeholder="Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs bg-card"
        />
        <Button onClick={openCreate} disabled={!canManage}>
          <Plus className="size-4" />
          Novo
        </Button>
      </div>

      {!canManage ? (
        <p className="text-xs text-muted-foreground">
          Somente perfis <strong>admin</strong> ou <strong>gestor</strong> podem incluir, editar ou
          excluir registros.
        </p>
      ) : null}

      <div className="rounded-lg border border-border bg-card">
        {query.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </div>
        ) : query.isError ? (
          <div className="p-6 text-sm text-destructive">
            {(query.error as Error).message}
            <p className="mt-2 text-xs text-muted-foreground">
              Se a tabela não existe, rode o script <code>db/fase1_cadastros.sql</code> no SQL
              Editor do seu Supabase.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center text-sm text-muted-foreground">{emptyLabel}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {tableFields.map((f) => (
                  <TableHead key={f.name}>{f.label}</TableHead>
                ))}
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={String(row["id"])}>
                  {tableFields.map((f) => (
                    <TableCell key={f.name}>
                      {f.type === "multicheck"
                        ? (f.checks ?? [])
                            .filter((c) => row[c.name])
                            .map((c) => c.label)
                            .join(", ") || "—"
                        : f.type === "checkbox"
                          ? row[f.name]
                            ? "Sim"
                            : "Não"
                          : String(row[f.name] ?? "—")}
                    </TableCell>
                  ))}


                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canManage}
                        onClick={() => openEdit(row)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={!canManage}
                        onClick={() => remove.mutate(row["id"] as string)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar registro" : "Novo registro"}</DialogTitle>
            <DialogDescription>Preencha os campos e salve para gravar no banco.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <div
                key={field.name}
                className={`space-y-1.5 ${field.span === 2 ? "sm:col-span-2" : ""}`}
              >
                <Label htmlFor={field.name}>{field.label}</Label>
                {field.auto ? (
                  <Input
                    id={field.name}
                    readOnly
                    disabled
                    value={String(form[field.name] ?? "")}
                    placeholder="Gerado automaticamente"
                  />
                ) : field.type === "multicheck" ? (
                  <div className="flex flex-wrap gap-2 rounded-md border border-input bg-background p-3">
                    {(field.checks ?? []).map((c) => (
                      <label
                        key={c.name}
                        className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                          form[c.name]
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-input text-muted-foreground hover:bg-accent/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(form[c.name])}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, [c.name]: e.target.checked }))
                          }
                          className="size-4 accent-primary"
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                ) : field.type === "ref" ? (
                  <RefSelect
                    field={field}
                    value={String(form[field.name] ?? "")}
                    onChange={(v) => setForm((f) => ({ ...f, [field.name]: v }))}
                  />
                ) : field.type === "select" ? (

                  <select
                    id={field.name}
                    value={String(form[field.name] ?? "")}
                    onChange={(e) => setForm((f) => ({ ...f, [field.name]: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">—</option>
                    {field.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === "checkbox" ? (
                  <div className="flex h-9 items-center">
                    <input
                      id={field.name}
                      type="checkbox"
                      checked={Boolean(form[field.name])}
                      onChange={(e) => setForm((f) => ({ ...f, [field.name]: e.target.checked }))}
                      className="size-4 accent-primary"
                    />
                  </div>
                ) : (
                  <Input
                    id={field.name}
                    type={field.type === "number" ? "number" : field.type ?? "text"}
                    step={field.step}
                    value={String(form[field.name] ?? "")}
                    onChange={(e) => setForm((f) => ({ ...f, [field.name]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
