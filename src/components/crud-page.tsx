import { StatusBadge } from "@/components/status-badge";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Columns3, Loader2, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FilterBar, FilterSelect, FilterText } from "@/components/filter-bar";
import { useCentro } from "@/lib/centro-store";
import { useSupabase } from "@/lib/supabase-provider";

export type FieldType =
  "text" | "email" | "number" | "date" | "select" | "checkbox" | "multicheck" | "ref";

export type CrudField = {
  name: string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  /** Colunas booleanas exibidas como grupo de caixas de seleção (type: "multicheck"). */
  checks?: { name: string; label: string }[];
  /** Seleção de registro relacionado (type: "ref"). */
  /** emptyLabel: texto da opção vazia (ex.: "Todos os centros"). */
  ref?: { table: string; labelField: string; emptyLabel?: string };
  required?: boolean;
  step?: string;
  inTable?: boolean;
  /** Largura no formulário: 1 = 1/4 da linha, 2 = linha inteira, padrão = metade. */
  span?: 1 | 2;
  /** Campo editável que não é gravado no banco (ex.: markup calculado). */
  virtual?: boolean;
  /** Campo gerado pelo banco (ex.: código sequencial): somente leitura e não enviado. */
  auto?: boolean;
  /** Gravado normalmente, mas não exibido na grade do formulário (ex.: preenchido por um bloco próprio). */
  hiddenInForm?: boolean;
  /** Só exibe no formulário quando este campo do form estiver marcado. */
  showIf?: string;
  /** Regra livre de exibição no formulário. */
  showWhen?: (form: Record<string, string | boolean>) => boolean;
  /** Título de seção exibido antes deste campo no formulário. */
  section?: string;
  /** Bloco próprio exibido logo depois deste campo (largura total). */
  after?: (ctx: {
    form: Record<string, string | boolean>;
    editing: Record<string, unknown> | null;
    patch: (values: Record<string, string>) => void;
    openRow: (row: Record<string, unknown>) => void;
  }) => React.ReactNode;
  /** Sugestões vindas de um cadastro padrão, sem trocar o valor textual salvo. */
  lookup?: string;
  /** Gera filtro de seleção com os valores existentes na lista. */
  filter?: boolean;
};

/** Sugestões textuais vindas de um cadastro padrão. */
function LookupList({ id, table }: { id: string; table: string }) {
  const { client } = useSupabase();
  const query = useQuery({
    queryKey: ["lookup", table],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from(table)
        .select("nome, ativo")
        .eq("ativo", true)
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as { nome: string }[];
    },
  });

  const nomes = Array.from(new Set((query.data ?? []).map((row) => row.nome).filter(Boolean)));
  return (
    <datalist id={id}>
      {nomes.map((nome) => (
        <option key={nome} value={nome} />
      ))}
    </datalist>
  );
}

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
      return (data ?? []) as unknown as Record<string, unknown>[];
    },
  });
}

/** Nome legível de um registro relacionado, exibido na grade. */
function RefLabel({ field, value }: { field: CrudField; value: unknown }) {
  const options = useRefOptions(field);
  if (value === null || value === undefined || value === "")
    return <>{field.ref?.emptyLabel ?? "—"}</>;
  const row = (options.data ?? []).find((r) => String(r["id"]) === String(value));
  return <>{row ? String(row[field.ref!.labelField] ?? "—") : options.isLoading ? "…" : "—"}</>;
}

function RefSelect({
  field,
  value,
  onChange,
  disabled = false,
}: {
  field: CrudField;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const options = useRefOptions(field);
  return (
    <select
      id={field.name}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
    >
      <option value="">{field.ref?.emptyLabel ?? "—"}</option>
      {(options.data ?? []).map((o) => (
        <option key={String(o["id"])} value={String(o["id"])}>
          {String(o[field.ref!.labelField] ?? "")}
        </option>
      ))}
    </select>
  );
}

export type Row = Record<string, unknown>;

const CRUD_PROTECTED_TABLES = new Set([
  "pedidos",
  "pedido_itens",
  "compras",
  "compra_itens",
  "estoque_movimentos",
  "estoque_saldos",
  "transferencias_estoque",
  "transferencias_estoque_itens",
  "contas_receber",
  "contas_pagar",
  "comissoes",
  "movimentos_financeiros",
  "transferencias",
  "boletos",
  "creditos_clientes",
  "creditos_clientes_aplicacoes",
  "expedicoes",
  "pedido_separacoes",
  "cargas",
  "carga_pedidos",
  "estornos_financeiros",
  "auditoria",
  "pedido_operacoes",
  "devolucao_operacoes",
  "comissao_pagamentos",
  "comissao_pagamento_itens",
  "sicredi_config",
  "user_roles",
]);

export function CrudPage({
  table,
  fields,
  orderBy,
  emptyLabel,
  searchColumns,
  onFieldChange,
  decorate,
  inlineEdit,
  onInlineSave,
  extraForm,
  extraFormTop,
  extraFormEnd,
  readOnly = false,
  uppercase = false,
  initialEditId,
  defaultValues,
}: {
  table: string;
  fields: CrudField[];
  orderBy: string;
  emptyLabel: string;
  searchColumns: string[];
  /** Recalcula outros campos quando um campo muda (ex.: markup ↔ preço de venda). */
  onFieldChange?: (
    name: string,
    value: string,
    form: Record<string, string | boolean>,
  ) => Record<string, string | boolean> | void;
  /** Acrescenta colunas calculadas às linhas (ex.: promoção vigente do produto). */
  decorate?: (rows: Row[]) => Row[];
  /** Campos editáveis direto na listagem. */
  inlineEdit?: string[];
  /** Converte a edição inline no patch gravado (ex.: markup ↔ preço de venda). */
  onInlineSave?: (row: Row, name: string, value: string) => Record<string, unknown>;
  /** Blocos extras dentro do formulário (ex.: comissão do representante). */
  extraForm?: (ctx: {
    form: Record<string, string | boolean>;
    editing: Row | null;
    /** Preenche campos do formulário sem gravar (ex.: consulta cadastral). */
    patch: (values: Record<string, string>) => void;
    /** Abre o formulário de um registro já existente. */
    openRow: (row: Row) => void;
  }) => React.ReactNode;
  /** Exibe o bloco extra antes dos campos (ex.: escolher tipo de pessoa e pesquisar o documento). */
  extraFormTop?: boolean;
  /** Bloco extra exibido depois de todos os campos. */
  extraFormEnd?: (ctx: {
    form: Record<string, string | boolean>;
    editing: Row | null;
    patch: (values: Record<string, string>) => void;
    openRow: (row: Row) => void;
  }) => React.ReactNode;
  /** Modo somente leitura: impede criar, editar, excluir e salvar. */
  readOnly?: boolean;
  /** Textos digitados e gravados em MAIÚSCULO (exceto e-mail). */
  uppercase?: boolean;
  initialEditId?: string | undefined;
  defaultValues?: Record<string, string | boolean>;
}) {
  const isUpperField = (f: CrudField) => !f.type || f.type === "text";
  const { client, user, canManage } = useSupabase();
  const { centro } = useCentro();
  const queryClient = useQueryClient();
  const effectiveReadOnly = readOnly === true;
  const directWriteBlocked = effectiveReadOnly || !canManage || CRUD_PROTECTED_TABLES.has(table);

  function assertDirectWriteAllowed() {
    if (effectiveReadOnly || !canManage)
      throw new Error("Seu perfil permite somente consultar este cadastro.");
    if (CRUD_PROTECTED_TABLES.has(table)) {
      throw new Error(`A tabela ${table} exige operação controlada por RPC.`);
    }
  }
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [search, setSearch] = useState("");
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const setF = (k: string, v: string) => setFiltros((s) => ({ ...s, [k]: v }));

  const query = useQuery({
    queryKey: [table],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from(table).select("*").order(orderBy);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  /** Campos que geram filtro automático (seleções, caixas e datas exibidas na tabela). */
  const filterFields = useMemo(
    () =>
      fields.filter(
        (f) =>
          (f.type === "select" && (f.options ?? []).length > 0) ||
          f.type === "checkbox" ||
          f.type === "date" ||
          f.filter ||
          (f.type === "multicheck" && (f.checks ?? []).length > 0),
      ),
    [fields],
  );

  const rows = useMemo(() => {
    let list = query.data ?? [];
    if (decorate) list = decorate(list);
    if (table !== "produtos" && centro && list.some((r) => "centro_id" in r)) {
      list = list.filter((r) => !r["centro_id"] || r["centro_id"] === centro);
    }

    for (const f of filterFields) {
      if (f.type === "date") {
        const de = filtros[`${f.name}__de`];
        const ate = filtros[`${f.name}__ate`];
        if (de) list = list.filter((r) => String(r[f.name] ?? "") >= de);
        if (ate) list = list.filter((r) => String(r[f.name] ?? "") <= ate);
        continue;
      }
      if (f.type === "multicheck") {
        const papel = filtros[f.name];
        if (papel) list = list.filter((r) => Boolean(r[papel]));
        continue;
      }
      const value = filtros[f.name];
      if (!value) continue;
      if (f.type === "checkbox") {
        list = list.filter((r) => String(Boolean(r[f.name])) === value);
      } else {
        list = list.filter((r) => String(r[f.name] ?? "") === value);
      }
    }
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((row) =>
      searchColumns.some((col) =>
        String(row[col] ?? "")
          .toLowerCase()
          .includes(term),
      ),
    );
  }, [query.data, search, searchColumns, centro, filterFields, filtros, decorate, table]);

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
    setForm({ ...next, ...defaultValues });
    setOpen(true);
  }

  const openEdit = useCallback(
    (row: Row) => {
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
    },
    [fields],
  );

  const abertoInicial = useRef("");
  const registroInicial = useQuery({
    queryKey: [table, "editar-registro", user?.id, initialEditId],
    enabled: !!client && !!initialEditId && !effectiveReadOnly,
    queryFn: async () => {
      const { data, error } = await client!
        .from(table)
        .select("*")
        .eq("id", initialEditId!)
        .maybeSingle();
      if (error) throw new Error("Não foi possível abrir o cadastro solicitado.");
      if (!data) throw new Error("Cadastro não encontrado ou sem acesso.");
      return data as Row;
    },
  });
  useEffect(() => {
    if (!initialEditId) {
      abertoInicial.current = "";
      return;
    }
    if (abertoInicial.current === initialEditId) return;
    if (registroInicial.data) {
      abertoInicial.current = initialEditId;
      openEdit(registroInicial.data);
    } else if (registroInicial.isError) {
      abertoInicial.current = initialEditId;
      toast.error(registroInicial.error.message);
    }
  }, [
    initialEditId,
    registroInicial.data,
    registroInicial.isError,
    registroInicial.error,
    openEdit,
  ]);

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
      const col = message.match(/column "([^"]+)"/)?.[1];
      const label = fields.find((f) => f.name === col)?.label ?? col;
      return label
        ? `Preencha o campo obrigatório: ${label}.`
        : "Preencha todos os campos obrigatórios.";
    }
    return message;
  }

  const save = useMutation({
    mutationFn: async () => {
      assertDirectWriteAllowed();
      const payload: Record<string, unknown> = {};
      for (const field of fields) {
        if (field.auto || field.virtual) continue;
        if (field.type === "multicheck") {
          for (const c of field.checks ?? []) payload[c.name] = Boolean(form[c.name]);
          continue;
        }
        const raw = form[field.name];
        if (field.type === "checkbox") {
          payload[field.name] = Boolean(raw);
        } else if (field.type === "number") {
          const txt = String(raw ?? "")
            .trim()
            .replace(/\./g, "")
            .replace(",", ".");
          const n = txt === "" ? NaN : Number(/,/.test(String(raw)) ? txt : String(raw).trim());
          // vazio/inválido: não envia (o banco aplica o padrão, ex. 0)
          if (Number.isNaN(n)) {
            if (editing) payload[field.name] = null;
            continue;
          }
          payload[field.name] = n;
        } else {
          if (raw === "" || raw == null) {
            if (editing) payload[field.name] = null;
            continue;
          }
          payload[field.name] = uppercase && isUpperField(field) ? String(raw).toUpperCase() : raw;
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
      if (table === "produtos") {
        for (const key of ["loja-catalogo", "vw_promocoes", "validar_pedido"])
          void queryClient.invalidateQueries({ queryKey: [key] });
      }
      if (table === "desconto_faixas_peso")
        queryClient.invalidateQueries({ queryKey: ["desconto_peso_pedido"] });
      if (table === "pessoas") {
        queryClient.invalidateQueries({ queryKey: ["pendencias"] });
        queryClient.invalidateQueries({ queryKey: ["clientes"] });
      }
    },
    onError: (error: Error) => toast.error(traduzErro(error.message)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      assertDirectWriteAllowed();
      const { error } = await client!.from(table).delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Registro excluído");
      queryClient.invalidateQueries({ queryKey: [table] });
      if (table === "produtos") {
        for (const key of ["loja-catalogo", "vw_promocoes", "validar_pedido"])
          void queryClient.invalidateQueries({ queryKey: [key] });
      }
      if (table === "desconto_faixas_peso")
        queryClient.invalidateQueries({ queryKey: ["desconto_peso_pedido"] });
      if (table === "pessoas") {
        queryClient.invalidateQueries({ queryKey: ["pendencias"] });
        queryClient.invalidateQueries({ queryKey: ["clientes"] });
      }
    },
    onError: (error: Error) => toast.error(traduzErro(error.message)),
  });

  const inlineUpdate = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      assertDirectWriteAllowed();
      const { error } = await client!.from(table).update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Atualizado");
      queryClient.invalidateQueries({ queryKey: [table] });
      if (table === "produtos") {
        for (const key of ["loja-catalogo", "vw_promocoes", "validar_pedido"])
          void queryClient.invalidateQueries({ queryKey: [key] });
      }
      if (table === "desconto_faixas_peso")
        queryClient.invalidateQueries({ queryKey: ["desconto_peso_pedido"] });
      if (table === "pessoas") {
        queryClient.invalidateQueries({ queryKey: ["pendencias"] });
        queryClient.invalidateQueries({ queryKey: ["clientes"] });
      }
    },
    onError: (error: Error) => toast.error(traduzErro(error.message)),
  });

  const inlineSet = new Set(inlineEdit ?? []);

  const [colunas, setColunas] = useState<string[] | null>(null);
  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(`colunas:${table}`);
      setColunas(salvo ? (JSON.parse(salvo) as string[]) : null);
    } catch {
      setColunas(null);
    }
  }, [table]);

  const tableFields = colunas
    ? fields.filter((f) => colunas.includes(f.name))
    : fields.filter((f) => f.inTable);

  function toggleColuna(name: string) {
    const atuais = tableFields.map((f) => f.name);
    const next = atuais.includes(name) ? atuais.filter((n) => n !== name) : [...atuais, name];
    setColunas(next);
    try {
      window.localStorage.setItem(`colunas:${table}`, JSON.stringify(next));
    } catch {
      // armazenamento local indisponível: a seleção permanece apenas na sessão.
    }
  }

  function resetColunas() {
    setColunas(null);
    try {
      window.localStorage.removeItem(`colunas:${table}`);
    } catch {
      // armazenamento local indisponível.
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          placeholder="Buscar..."
          aria-label="Buscar"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs bg-card"
        />
        <div className="flex gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" className="no-print">
                <Columns3 className="size-4" />
                Colunas
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Dados visíveis na lista
              </p>
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {fields.map((f) => (
                  <label key={f.name} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={tableFields.some((t) => t.name === f.name)}
                      onChange={() => toggleColuna(f.name)}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
              <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={resetColunas}>
                Restaurar padrão
              </Button>
            </PopoverContent>
          </Popover>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" />
            Imprimir
          </Button>
          <Button onClick={openCreate} disabled={directWriteBlocked || !canManage}>
            <Plus className="size-4" />
            Novo
          </Button>
        </div>
      </div>

      {filterFields.length > 0 ? (
        <FilterBar onClear={() => setFiltros({})}>
          {filterFields.map((f) =>
            f.type === "date" ? (
              <div key={f.name} className="grid grid-cols-2 gap-2 sm:col-span-2">
                <FilterText
                  label={`${f.label} de`}
                  type="date"
                  value={filtros[`${f.name}__de`] ?? ""}
                  onChange={(v) => setF(`${f.name}__de`, v)}
                />
                <FilterText
                  label={`${f.label} até`}
                  type="date"
                  value={filtros[`${f.name}__ate`] ?? ""}
                  onChange={(v) => setF(`${f.name}__ate`, v)}
                />
              </div>
            ) : f.type === "multicheck" ? (
              <FilterSelect
                key={f.name}
                label={f.label}
                value={filtros[f.name] ?? ""}
                onChange={(v) => setF(f.name, v)}
                options={(f.checks ?? []).map((c) => ({ value: c.name, label: c.label }))}
              />
            ) : f.type === "checkbox" ? (
              <FilterSelect
                key={f.name}
                label={f.label}
                value={filtros[f.name] ?? ""}
                onChange={(v) => setF(f.name, v)}
                options={[
                  { value: "true", label: "Sim" },
                  { value: "false", label: "Não" },
                ]}
              />
            ) : (
              <FilterSelect
                key={f.name}
                label={f.label}
                value={filtros[f.name] ?? ""}
                onChange={(v) => setF(f.name, v)}
                options={
                  f.filter && !(f.options ?? []).length
                    ? [
                        ...new Set(
                          (query.data ?? []).map((r) => String(r[f.name] ?? "")).filter(Boolean),
                        ),
                      ]
                        .sort()
                        .map((v) => ({ value: v, label: v }))
                    : (f.options ?? [])
                }
              />
            ),
          )}
        </FilterBar>
      ) : null}

      <p className="text-xs text-muted-foreground">{rows.length} registro(s)</p>

      {!canManage && !effectiveReadOnly ? (
        <p className="text-xs text-muted-foreground">
          Somente perfis <strong>admin</strong> ou <strong>gestor</strong> podem incluir, editar ou
          excluir registros.
        </p>
      ) : null}
      {CRUD_PROTECTED_TABLES.has(table) && !effectiveReadOnly ? (
        <p className="text-xs text-muted-foreground">
          Esta tabela possui escrita protegida. Alterações devem ser feitas pelo fluxo operacional
          específico, que executa as RPCs e validações do banco.
        </p>
      ) : null}

      <div className="print-area rounded-lg border border-border bg-card">
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
          <Table className="mobile-cards">
            <TableHeader>
              <TableRow>
                {tableFields.map((f) => (
                  <TableHead key={f.name}>{f.label}</TableHead>
                ))}
                <TableHead className="no-print w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={String(row["id"])}>
                  {tableFields.map((f) => (
                    <TableCell key={f.name} data-label={f.label}>
                      {f.name === "status" ? (
                        <StatusBadge value={row[f.name]} />
                      ) : inlineSet.has(f.name) && canManage && !directWriteBlocked ? (
                        <Input
                          key={`${String(row["id"])}-${String(row[f.name] ?? "")}`}
                          type="number"
                          step={f.step ?? "0.01"}
                          aria-label={f.label}
                          defaultValue={
                            row[f.name] === null || row[f.name] === undefined
                              ? ""
                              : Number(row[f.name]).toFixed(2)
                          }
                          className="h-8 w-24"
                          onBlur={(e) => {
                            const antes =
                              row[f.name] === null || row[f.name] === undefined
                                ? ""
                                : Number(row[f.name]).toFixed(2);
                            if (e.target.value === antes) return;
                            const patch = onInlineSave
                              ? onInlineSave(row, f.name, e.target.value)
                              : { [f.name]: e.target.value === "" ? null : Number(e.target.value) };
                            if (Object.keys(patch).length === 0) return;
                            inlineUpdate.mutate({ id: row["id"] as string, patch });
                          }}
                        />
                      ) : f.type === "multicheck" ? (
                        (f.checks ?? [])
                          .filter((c) => row[c.name])
                          .map((c) => c.label)
                          .join(", ") || "—"
                      ) : f.type === "checkbox" ? (
                        row[f.name] ? (
                          "Sim"
                        ) : (
                          "Não"
                        )
                      ) : f.type === "ref" && f.ref ? (
                        <RefLabel field={f} value={row[f.name]} />
                      ) : f.type === "select" && f.options?.length ? (
                        (f.options.find((o) => o.value === String(row[f.name] ?? ""))?.label ??
                        String(row[f.name] ?? "—"))
                      ) : (
                        String(row[f.name] ?? "—")
                      )}
                    </TableCell>
                  ))}

                  <TableCell data-label="Ações" className="no-print text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={directWriteBlocked || !canManage}
                        aria-label="Editar registro"
                        onClick={() => openEdit(row)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={directWriteBlocked || !canManage}
                        aria-label="Excluir registro"
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
            <DialogTitle>
              {editing
                ? directWriteBlocked
                  ? "Visualizar registro"
                  : "Editar registro"
                : "Novo registro"}
            </DialogTitle>
            <DialogDescription>Preencha os campos e salve para gravar no banco.</DialogDescription>
          </DialogHeader>
          {extraForm && extraFormTop ? (
            <div className="mb-4">
              {extraForm({
                form,
                editing,
                patch: (values) => setForm((f) => ({ ...f, ...values })),
                openRow: (row) => openEdit(row),
              })}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-4">
            {fields
              .filter(
                (f) =>
                  !f.hiddenInForm &&
                  (!f.showIf || !!form[f.showIf]) &&
                  (!f.showWhen || f.showWhen(form)),
              )
              .map((field) => (
                <Fragment key={field.name}>
                  {field.section ? (
                    <h3 className="border-b border-border pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:col-span-4">
                      {field.section}
                    </h3>
                  ) : null}
                  <div
                    key={field.name}
                    className={`space-y-1.5 ${
                      field.span === 2
                        ? "sm:col-span-4"
                        : field.span === 1
                          ? "sm:col-span-1"
                          : "sm:col-span-2"
                    }`}
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
                              disabled={directWriteBlocked}
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
                        disabled={directWriteBlocked}
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
                          disabled={directWriteBlocked}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, [field.name]: e.target.checked }))
                          }
                          className="size-4 accent-primary"
                        />
                      </div>
                    ) : (
                      <>
                        {field.lookup ? (
                          <LookupList id={`lk-${field.name}`} table={field.lookup} />
                        ) : null}
                        <Input
                          id={field.name}
                          list={field.lookup ? `lk-${field.name}` : undefined}
                          autoComplete={field.lookup ? "off" : undefined}
                          type={field.type === "number" ? "number" : (field.type ?? "text")}
                          step={field.step}
                          value={String(form[field.name] ?? "")}
                          disabled={directWriteBlocked}
                          onBlur={(e) => {
                            if (field.type !== "number" || !field.step) return;
                            const dec = (field.step.split(".")[1] ?? "").length;
                            const raw = e.target.value;
                            if (raw === "" || Number.isNaN(Number(raw))) return;
                            const fixed = Number(raw).toFixed(dec);
                            if (fixed !== raw) setForm((f) => ({ ...f, [field.name]: fixed }));
                          }}
                          onChange={(e) =>
                            setForm((f) => {
                              const val =
                                uppercase && isUpperField(field)
                                  ? e.target.value.toUpperCase()
                                  : e.target.value;
                              const next = { ...f, [field.name]: val };
                              const patch = onFieldChange?.(field.name, val, next);
                              return patch ? { ...next, ...patch } : next;
                            })
                          }
                        />
                      </>
                    )}
                  </div>
                  {field.after ? (
                    <div className="sm:col-span-4">
                      {field.after({
                        form,
                        editing,
                        patch: (values) => setForm((f) => ({ ...f, ...values })),
                        openRow: (row) => openEdit(row),
                      })}
                    </div>
                  ) : null}
                </Fragment>
              ))}
          </div>
          {extraFormEnd ? (
            <div className="mt-4">
              {extraFormEnd({
                form,
                editing,
                patch: (values) => setForm((f) => ({ ...f, ...values })),
                openRow: (row) => openEdit(row),
              })}
            </div>
          ) : null}
          {extraForm && !extraFormTop ? (
            <div className="mt-4">
              {extraForm({
                form,
                editing,
                patch: (values) => setForm((f) => ({ ...f, ...values })),
                openRow: (row) => openEdit(row),
              })}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} disabled={directWriteBlocked || save.isPending}>
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
