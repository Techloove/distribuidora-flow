import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Pencil, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CentrosPorUsuario } from "@/components/centros-por-usuario";
import { ErpLayout } from "@/components/erp-layout";
import { MenusPorPerfil } from "@/components/menus-por-perfil";
import { PapeisAdmin } from "@/components/papeis-admin";
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
import { usePapeis } from "@/lib/papeis";
import { useSupabase, type AppRole } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários e papéis — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Administração de usuários do ERP com cadastro, edição, exclusão e concessão de papéis RBAC validada no servidor.",
      },
      { property: "og:title", content: "Usuários e papéis — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Controle de acesso por papéis: administrador, financeiro, comercial e operação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsuariosPage,
});

type Row = Record<string, unknown>;
type Form = {
  userId: string;
  nome: string;
  email: string;
  telefone: string;
  senha: string;
  ativo: boolean;
};

const vazio: Form = { userId: "", nome: "", email: "", telefone: "", senha: "", ativo: true };

function UsuariosPage() {
  const { client, roles } = useSupabase();
  const { papeis } = usePapeis();
  const queryClient = useQueryClient();
  const isAdmin = roles.includes("admin");
  const [form, setForm] = useState<Form | null>(null);
  const [excluir, setExcluir] = useState<Row | null>(null);

  const profiles = useQuery({
    queryKey: ["profiles", "admin"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("profiles").select("*").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const userRoles = useQuery({
    queryKey: ["user_roles", "admin"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.from("user_roles").select("user_id, role");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const representantes = useQuery({
    queryKey: ["representantes", "usuarios"],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("representantes")
        .select("id, nome, profile_id, ativo")
        .order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const vincular = useMutation({
    mutationFn: async ({ userId, repId }: { userId: string; repId: string }) => {
      const { error } = await client!.rpc("admin_vincular_representante", {
        _user_id: userId,
        _representante_id: repId || null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Vínculo atualizado");
      queryClient.invalidateQueries({ queryKey: ["representantes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recarregar = () => {
    queryClient.invalidateQueries({ queryKey: ["profiles"] });
    queryClient.invalidateQueries({ queryKey: ["user_roles"] });
    queryClient.invalidateQueries({ queryKey: ["representantes"] });
  };

  const toggle = useMutation({
    mutationFn: async ({
      userId,
      role,
      conceder,
    }: {
      userId: string;
      role: AppRole;
      conceder: boolean;
    }) => {
      const { error } = await client!.rpc("definir_papel", {
        _user_id: userId,
        _role: role,
        _conceder: conceder,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Papéis atualizados");
      queryClient.invalidateQueries({ queryKey: ["user_roles", "admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvar = useMutation({
    mutationFn: async (f: Form) => {
      if (f.userId) {
        const { error } = await client!.rpc("admin_atualizar_usuario", {
          _user_id: f.userId,
          _nome: f.nome,
          _email: f.email,
          _telefone: f.telefone,
          _ativo: f.ativo,
          _senha: f.senha || null,
        });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await client!.rpc("admin_criar_usuario", {
          _email: f.email,
          _senha: f.senha,
          _nome: f.nome,
          _telefone: f.telefone,
        });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: (_d, f) => {
      toast.success(f.userId ? "Usuário atualizado" : "Usuário cadastrado");
      setForm(null);
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const aprovar = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await client!.rpc("admin_aprovar_cadastro", { _user_id: userId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Cadastro aprovado. O usuário já pode acessar os módulos autorizados.");
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remover = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await client!.rpc("admin_excluir_usuario", { _user_id: userId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Usuário excluído");
      setExcluir(null);
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rolesOf = (userId: unknown) =>
    (userRoles.data ?? [])
      .filter((r) => r["user_id"] === userId)
      .map((r) => String(r["role"]) as AppRole);

  const set = (k: keyof Form, v: string | boolean) =>
    setForm((prev) => (prev ? { ...prev, [k]: v } : prev));

  const editando = !!form?.userId;

  return (
    <ErpLayout
      title="Usuários e papéis"
      description="Cadastre, edite ou exclua usuários. Cada papel libera módulos específicos e toda alteração é validada no servidor."
      actions={
        isAdmin ? (
          <Button size="sm" onClick={() => setForm({ ...vazio })}>
            <UserPlus className="mr-2 size-4" /> Novo usuário
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        <PapeisAdmin />
        <MenusPorPerfil />
        <CentrosPorUsuario />
        {!isAdmin ? (
          <p className="text-xs text-muted-foreground">
            Somente perfis <strong>admin</strong> podem cadastrar, editar, excluir usuários ou
            alterar papéis.
          </p>
        ) : null}

        <div className="rounded-lg border border-border bg-card">
          {profiles.isLoading || userRoles.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </div>
          ) : profiles.isError || userRoles.isError ? (
            <div className="p-6 text-sm text-destructive">
              {((profiles.error ?? userRoles.error) as Error).message}
              <p className="mt-2 text-xs text-muted-foreground">
                Rode <code>db/fase5_rbac_comissoes.sql</code> no SQL Editor do Supabase.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Representante / vendedor</TableHead>
                    <TableHead>Papéis</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(profiles.data ?? []).map((p) => {
                    const current = rolesOf(p["id"]);
                    return (
                      <TableRow key={String(p["id"])}>
                        <TableCell>
                          {String(p["nome"] || "—")}
                          {p["ativo"] === false ? (
                            <span className="ml-2 text-xs font-medium text-amber-700">(pendente / sem acesso)</span>
                          ) : null}
                        </TableCell>
                        <TableCell>{String(p["email"] ?? "—")}</TableCell>
                        <TableCell>
                          <select
                            value={String(
                              representantes.data?.find((r) => r["profile_id"] === p["id"])?.[
                                "id"
                              ] ?? "",
                            )}
                            disabled={!isAdmin || vincular.isPending}
                            onChange={(e) =>
                              vincular.mutate({ userId: String(p["id"]), repId: e.target.value })
                            }
                            className="h-9 w-full min-w-44 rounded-md border border-input bg-background px-2 text-sm"
                          >
                            <option value="">Sem vínculo</option>
                            {(representantes.data ?? [])
                              .filter(
                                (r) => !r["profile_id"] || r["profile_id"] === p["id"],
                              )
                              .map((r) => (
                                <option key={String(r["id"])} value={String(r["id"])}>
                                  {String(r["nome"])}
                                </option>
                              ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            {papeis.map((papel) => {
                              const role = papel.codigo as AppRole;
                              const active = current.includes(role);
                              return (
                                <Button
                                  key={role}
                                  size="sm"
                                  variant={active ? "default" : "outline"}
                                  disabled={!isAdmin || toggle.isPending}
                                  onClick={() =>
                                    toggle.mutate({
                                      userId: String(p["id"]),
                                      role,
                                      conceder: !active,
                                    })
                                  }
                                >
                                  {papel.nome}
                                </Button>
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1.5">
                            {isAdmin && p["ativo"] === false ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={aprovar.isPending || current.length === 0}
                                title={current.length === 0 ? "Atribua um papel antes de aprovar" : "Aprovar cadastro"}
                                onClick={() => aprovar.mutate(String(p["id"]))}
                              >
                                Aprovar acesso
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!isAdmin}
                              onClick={() =>
                                setForm({
                                  userId: String(p["id"]),
                                  nome: String(p["nome"] ?? ""),
                                  email: String(p["email"] ?? ""),
                                  telefone: String(p["telefone"] ?? ""),
                                  senha: "",
                                  ativo: p["ativo"] !== false,
                                })
                              }
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!isAdmin}
                              onClick={() => setExcluir(p)}
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!form} onOpenChange={(o) => (o ? null : setForm(null))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar usuário" : "Novo usuário"}</DialogTitle>
            <DialogDescription>
              {editando
                ? "Altere os dados do perfil. A senha só muda se você preencher o campo."
                : "O usuário é criado com acesso pendente. Atribua um papel e aprove o cadastro para liberar os módulos."}
            </DialogDescription>
          </DialogHeader>

          {form ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Nome</Label>
                <Input value={form.nome} onChange={(e) => set("nome", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Telefone</Label>
                <Input value={form.telefone} onChange={(e) => set("telefone", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{editando ? "Nova senha (opcional)" : "Senha"}</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={form.senha}
                  onChange={(e) => set("senha", e.target.value)}
                />
              </div>
              {editando ? (
                <div className="space-y-1.5">
                  <Label>Situação</Label>
                  <Button
                    type="button"
                    variant={form.ativo ? "default" : "outline"}
                    className="w-full"
                    onClick={() => set("ativo", !form.ativo)}
                  >
                    {form.ativo ? "Ativo" : "Inativo"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button
              disabled={
                salvar.isPending ||
                !form?.email ||
                (!editando && (form?.senha ?? "").length < 6)
              }
              onClick={() => form && salvar.mutate(form)}
            >
              {salvar.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!excluir} onOpenChange={(o) => (o ? null : setExcluir(null))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir usuário</DialogTitle>
            <DialogDescription>
              {String(excluir?.["nome"] || excluir?.["email"] || "")} perderá o acesso
              definitivamente. Os documentos já lançados continuam no histórico.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcluir(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={remover.isPending}
              onClick={() => excluir && remover.mutate(String(excluir["id"]))}
            >
              {remover.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ErpLayout>
  );
}
