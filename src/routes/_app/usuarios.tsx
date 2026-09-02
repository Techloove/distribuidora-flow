import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ErpLayout } from "@/components/erp-layout";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSupabase, type AppRole } from "@/lib/supabase-provider";

export const Route = createFileRoute("/_app/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários e papéis — ERP Distribuidora" },
      {
        name: "description",
        content:
          "Administração de usuários do ERP com concessão e remoção de papéis RBAC validada no servidor.",
      },
      { property: "og:title", content: "Usuários e papéis — ERP Distribuidora" },
      {
        property: "og:description",
        content: "Controle de acesso por papéis: admin, gestor, financeiro, comercial e operação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsuariosPage,
});

const ROLES: AppRole[] = [
  "admin",
  "gestor",
  "financeiro",
  "comercial",
  "representante",
  "estoque",
  "expedicao",
];

type Row = Record<string, unknown>;

function UsuariosPage() {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const isAdmin = roles.includes("admin");

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

  const rolesOf = (userId: unknown) =>
    (userRoles.data ?? [])
      .filter((r) => r["user_id"] === userId)
      .map((r) => String(r["role"]) as AppRole);

  return (
    <ErpLayout
      title="Usuários e papéis"
      description="Cada papel libera módulos específicos. A alteração é validada no banco e registrada na auditoria."
    >
      <div className="space-y-4">
        {!isAdmin ? (
          <p className="text-xs text-muted-foreground">
            Somente perfis <strong>admin</strong> podem conceder ou remover papéis.
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Papéis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(profiles.data ?? []).map((p) => {
                  const current = rolesOf(p["id"]);
                  return (
                    <TableRow key={String(p["id"])}>
                      <TableCell>{String(p["nome"] || "—")}</TableCell>
                      <TableCell>{String(p["email"] ?? "—")}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {ROLES.map((role) => {
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
                                {role}
                              </Button>
                            );
                          })}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </ErpLayout>
  );
}
