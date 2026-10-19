import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Loader2, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";

type Cadastro = Record<string, string | null>;
const campos = [
  ["nome", "Nome completo / razão social", "name", 120],
  ["cnpj_cpf", "CPF / CNPJ", "off", 18],
  ["telefone", "Telefone com DDD", "tel", 30],
  ["cep", "CEP", "postal-code", 9],
  ["logradouro", "Rua / avenida", "address-line1", 200],
  ["numero", "Número (ou S/N)", "off", 30],
  ["complemento", "Complemento (opcional)", "address-line2", 100],
  ["bairro", "Bairro", "off", 100],
  ["cidade", "Cidade", "address-level2", 100],
  ["uf", "UF", "address-level1", 2],
] as const;

export function CompletarCadastroRepresentante() {
  const { client, user, signOut } = useSupabase();
  const cadastro = useQuery({
    queryKey: ["meu-cadastro-inicial", user?.id],
    enabled: !!client && !!user,
    retry: false,
    queryFn: async () => {
      const { data, error } = await client!.rpc("meu_cadastro_inicial_238");
      if (error) throw new Error(error.message);
      return data as Cadastro;
    },
  });
  return (
    <main className="min-h-dvh bg-background px-4 py-8 sm:py-12">
      <section className="mx-auto max-w-2xl rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <UserRoundCheck className="size-9 text-primary" aria-hidden="true" />
        <p className="mt-4 flex items-center gap-2 text-sm font-medium text-primary">
          <CheckCircle2 className="size-4" /> Cadastro aprovado
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Complete seu cadastro</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Seu acesso foi autorizado. Confira seus dados e complete o endereço para começar a usar o
          sistema. As informações ficarão no seu Cadastro Unificado.
        </p>
        {cadastro.isPending ? (
          <p role="status" className="mt-6 flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Carregando seus dados…
          </p>
        ) : cadastro.isError ? (
          <div className="mt-6">
            <p role="alert" className="text-sm text-destructive">
              {cadastro.error.message}
            </p>
            <Button className="mt-3" variant="outline" onClick={() => void cadastro.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <FormularioCadastro key={user?.id} inicial={cadastro.data} />
        )}
        <Button
          className="mt-4"
          variant="ghost"
          onClick={() => void signOut().catch((e: Error) => toast.error(e.message))}
        >
          Sair e completar depois
        </Button>
      </section>
    </main>
  );
}

function FormularioCadastro({ inicial }: { inicial: Cadastro }) {
  const { client, user } = useSupabase();
  const queryClient = useQueryClient();
  const [dados, setDados] = useState<Cadastro>(() =>
    Object.fromEntries([
      ["tipo_pessoa", inicial["tipo_pessoa"] ?? "PF"],
      ...campos.map(([key]) => [key, inicial[key] ?? ""]),
    ]),
  );
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("completar_meu_cadastro_238", { _dados: dados });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Cadastro completo. Bem-vindo ao sistema!");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pessoas"] }),
        queryClient.invalidateQueries({ queryKey: ["representantes"] }),
        queryClient.invalidateQueries({ queryKey: ["session-permissions", user?.id] }),
      ]);
    },
  });
  return (
    <form
      className="mt-6 space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        salvar.mutate();
      }}
    >
      <fieldset disabled={salvar.isPending} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="cadastro-email">E-mail do acesso</Label>
          <Input
            id="cadastro-email"
            value={inicial["email"] ?? user?.email ?? ""}
            readOnly
            autoComplete="email"
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="cadastro-tipo">Tipo de pessoa</Label>
          <select
            id="cadastro-tipo"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={dados["tipo_pessoa"] ?? "PF"}
            onChange={(e) => setDados({ ...dados, tipo_pessoa: e.target.value })}
          >
            <option value="PF">Pessoa física (CPF)</option>
            <option value="PJ">Pessoa jurídica (CNPJ)</option>
          </select>
        </div>
        {campos.map(([key, label, autoComplete, maxLength]) => (
          <div
            key={key}
            className={`space-y-2 ${key === "nome" || key === "logradouro" ? "sm:col-span-2" : ""}`}
          >
            <Label htmlFor={`cadastro-${key}`}>{label}</Label>
            <Input
              id={`cadastro-${key}`}
              value={dados[key] ?? ""}
              required={key !== "complemento"}
              maxLength={maxLength}
              autoComplete={autoComplete}
              type={key === "telefone" ? "tel" : "text"}
              onChange={(e) =>
                setDados({
                  ...dados,
                  [key]: key === "uf" ? e.target.value.toUpperCase() : e.target.value,
                })
              }
            />
          </div>
        ))}
      </fieldset>
      {salvar.isError && (
        <p role="alert" className="text-sm text-destructive">
          {salvar.error.message}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={salvar.isPending || !client}>
        {salvar.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
        Salvar cadastro e acessar o sistema
      </Button>
    </form>
  );
}
