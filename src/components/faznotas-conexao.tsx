import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import {
  faznotasConexaoGet,
  faznotasConexaoSave,
  faznotasConexaoTest,
} from "@/lib/faznotas-conexao.functions";

export function FaznotasConexao({ loja, editar }: { loja: string; editar: boolean }) {
  const { session, roles } = useSupabase();
  const qc = useQueryClient();
  const get = useServerFn(faznotasConexaoGet);
  const save = useServerFn(faznotasConexaoSave);
  const test = useServerFn(faznotasConexaoTest);
  const [cnpj, setCnpj] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [resultado, setResultado] = useState("");
  const admin = editar && roles.includes("admin");
  const estado = useQuery({
    queryKey: ["faznotas-conexao", loja, session?.user.id],
    enabled: !!session,
    queryFn: () => get({ data: { loja, accessToken: session!.access_token } }),
  });
  const salvar = useMutation({
    mutationFn: () => {
      if (!confirmado) throw new Error("Confirme no painel FAZNOTAS o CNPJ associado ao token.");
      return save({
        data: {
          loja,
          accessToken: session!.access_token,
          cnpj: cnpj ?? estado.data?.cnpj_loja ?? "",
          token,
        },
      });
    },
    onSuccess: async () => {
      setToken("");
      setCnpj(null);
      setConfirmado(false);
      setResultado("");
      await qc.invalidateQueries({ queryKey: ["faznotas-conexao", loja] });
      toast.success("Credencial fiscal salva com acesso restrito ao servidor");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const testar = useMutation({
    mutationFn: () => test({ data: { loja, accessToken: session!.access_token } }),
    onSuccess: (r) => setResultado(r.mensagem),
    onError: (e: Error) => {
      setResultado("");
      toast.error(e.message);
    },
  });
  return (
    <section className="rounded-xl border p-4 space-y-4">
      <h3 className="font-semibold">Conexão FAZNOTAS por loja</h3>
      <p className="text-sm text-muted-foreground">
        Cadastre o token gerado em Meus Dados → Integração no painel FAZNOTAS da empresa desta loja.
        Esta conexão permite testar o acesso; o envio de notas permanece indisponível nesta etapa.
      </p>
      {estado.isLoading && <p>Consultando configuração protegida...</p>}
      {estado.error && (
        <p role="alert" className="text-destructive">
          {estado.error.message}
        </p>
      )}
      {estado.data && (
        <>
          <p className="text-sm">
            Token: {estado.data.token_configurado ? "cadastrado (oculto)" : "não cadastrado"}.{" "}
            {estado.data.token_configurado && !estado.data.cnpj_confere && (
              <span className="text-destructive">
                O CNPJ da loja mudou. Cadastre uma credencial correspondente antes de continuar.
              </span>
            )}
          </p>
          <Label htmlFor="faznotas-cnpj">CNPJ da empresa no painel FAZNOTAS</Label>
          <Input
            id="faznotas-cnpj"
            value={cnpj ?? estado.data.cnpj_loja}
            maxLength={24}
            disabled={!admin || salvar.isPending}
            onChange={(e) => {
              setCnpj(e.target.value);
              setConfirmado(false);
              setResultado("");
            }}
          />
          <Label htmlFor="faznotas-token">
            {estado.data.token_configurado
              ? "Substituir token (vazio preserva o atual para o mesmo CNPJ)"
              : "Token de integração"}
          </Label>
          <Input
            id="faznotas-token"
            type="password"
            autoComplete="new-password"
            value={token}
            maxLength={2048}
            disabled={!admin || salvar.isPending}
            onChange={(e) => {
              setToken(e.target.value);
              setConfirmado(false);
              setResultado("");
            }}
          />
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmado}
              disabled={!admin}
              onChange={(e) => setConfirmado(e.target.checked)}
            />
            Conferi no painel FAZNOTAS que este token pertence ao CNPJ desta loja.
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!admin || !confirmado || salvar.isPending || testar.isPending}
              onClick={() => salvar.mutate()}
            >
              Salvar conexão
            </Button>
            <Button
              variant="outline"
              disabled={
                !admin ||
                !estado.data.token_configurado ||
                !estado.data.cnpj_confere ||
                salvar.isPending ||
                testar.isPending ||
                !!token ||
                cnpj !== null
              }
              onClick={() => {
                setResultado("");
                testar.mutate();
              }}
            >
              {testar.isPending ? "Testando acesso..." : "Testar acesso sem emitir nota"}
            </Button>
          </div>
          {!admin && (
            <p className="text-sm text-muted-foreground">
              Somente o administrador pode cadastrar ou testar a credencial fiscal.
            </p>
          )}
          {resultado && (
            <p role="status" className="rounded-md bg-muted p-3 text-sm">
              {resultado}
            </p>
          )}
        </>
      )}
    </section>
  );
}
