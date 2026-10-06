import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSupabase } from "@/lib/supabase-provider";

type Rep = { id: string; nome: string; profile_id: string | null; ativo: boolean };
type Profile = { id: string; email: string | null };

const LOGIN_DOMAIN = "@rep-login.example.com";

function usuarioBase(nome: string): string {
  return nome.trim().split(/\s+/)[0]!.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A conta continua usando Supabase Auth. O e-mail tecnico e gerado internamente,
 * nao precisa ser informado nem utilizado pelo representante.
 */
export function AcessosRepresentantes() {
  const { client, roles } = useSupabase();
  const queryClient = useQueryClient();
  const isAdmin = roles.includes("admin");
  const [ultimoAcesso, setUltimoAcesso] = useState<{ nome: string; login: string } | null>(null);

  const reps = useQuery({
    queryKey: ["representantes", "provisionamento"],
    enabled: !!client && isAdmin,
    queryFn: async () => {
      const { data, error } = await client!.from("representantes")
        .select("id, nome, profile_id, ativo").order("nome");
      if (error) throw new Error(error.message);
      return (data ?? []) as Rep[];
    },
  });

  const profiles = useQuery({
    queryKey: ["profiles", "provisionamento"],
    enabled: !!client && isAdmin,
    queryFn: async () => {
      const { data, error } = await client!.from("profiles").select("id, email");
      if (error) throw new Error(error.message);
      return (data ?? []) as Profile[];
    },
  });

  const criar = useMutation({
    mutationFn: async (rep: Rep) => {
      if (!isAdmin) throw new Error("Somente administradores podem criar acessos.");
      if (rep.profile_id) throw new Error("Este representante já possui acesso vinculado.");
      const base = usuarioBase(rep.nome);
      if (!base) throw new Error("O primeiro nome deve conter letras ou números.");
      const usados = new Set((profiles.data ?? [])
        .map((p) => (p.email ?? "").toLowerCase()));
      let n = 1;
      let usuario = base;
      while (usados.has(usuario + LOGIN_DOMAIN)) {
        n += 1;
        usuario = base + n;
      }

      // A RPC administrativa existente mantém o hash exclusivamente no Supabase Auth.
      const { data: userId, error: erroCriar } = await client!.rpc("admin_criar_usuario", {
        _email: usuario + LOGIN_DOMAIN,
        _senha: "123456",
        _nome: rep.nome,
        _telefone: null,
      });
      if (erroCriar) throw new Error(erroCriar.message);
      if (!userId) throw new Error("A criação da conta não retornou um usuário válido.");

      const { error: erroPapel } = await client!.rpc("definir_papel", {
        _user_id: userId,
        _role: "representante",
        _conceder: true,
      });
      if (erroPapel) throw new Error(
        "A conta foi criada, mas não recebeu o papel representante. Conclua o vínculo na área Usuários. " +
        erroPapel.message,
      );

      const { error: erroVinculo } = await client!.rpc("admin_vincular_representante", {
        _user_id: userId,
        _representante_id: rep.id,
      });
      if (erroVinculo) throw new Error(
        "A conta foi criada, mas o vínculo não foi concluído. Ajuste em Usuários. " +
        erroVinculo.message,
      );

      return { nome: rep.nome, login: usuario };
    },
    onSuccess: (resultado) => {
      setUltimoAcesso(resultado);
      toast.success("Acesso criado. Oriente o representante a trocar a senha inicial.");
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
      void queryClient.invalidateQueries({ queryKey: ["representantes"] });
      void queryClient.invalidateQueries({ queryKey: ["user_roles"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!isAdmin) return null;
  const pendentes = (reps.data ?? []).filter((rep) => rep.ativo && !rep.profile_id);
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="font-semibold">Acesso de representantes</h2>
      <p className="text-sm text-muted-foreground">
        Gere o login pelo primeiro nome, sem exigir e-mail. A senha temporária é 123456.
        Representantes com primeiro nome repetido recebem numeração (ex.: joao2).
      </p>
      {ultimoAcesso ? (
        <p role="status" className="text-sm">
          Acesso de {ultimoAcesso.nome}: usuário <strong>{ultimoAcesso.login}</strong>.
          Entregue a senha temporária apenas ao representante.
        </p>
      ) : null}
      {reps.isLoading || profiles.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando representantes…</p>
      ) : reps.isError || profiles.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível verificar os representantes e os logins existentes.
        </p>
      ) : pendentes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum representante ativo sem acesso.</p>
      ) : (
        <div className="grid gap-2">
          {pendentes.map((rep) => (
            <div key={rep.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <span className="text-sm">{rep.nome}</span>
              <Button type="button" size="sm" variant="outline"
                disabled={criar.isPending} onClick={() => criar.mutate(rep)}>
                {criar.isPending && criar.variables?.id === rep.id
                  ? <Loader2 className="mr-2 size-4 animate-spin" />
                  : <KeyRound className="mr-2 size-4" />}
                Criar acesso
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
