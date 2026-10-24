import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import { ForecastLiberacaoHml } from "./forecast-liberacao-hml";
import {
  forecastConexaoGet,
  forecastConexaoSave,
  forecastConexaoTest,
} from "@/lib/forecast-conexao.functions";

export function ForecastConexao({ loja }: { loja: string }) {
  const { session, roles } = useSupabase();
  const qc = useQueryClient();
  const get = useServerFn(forecastConexaoGet);
  const save = useServerFn(forecastConexaoSave);
  const test = useServerFn(forecastConexaoTest);
  const [token, setToken] = useState("");
  const [ambiente, setAmbiente] = useState<"homologacao" | "producao" | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [resultado, setResultado] = useState("");
  const admin = roles.includes("admin");
  const estado = useQuery({
    queryKey: ["forecast-conexao", loja, session?.user.id],
    enabled: !!session,
    queryFn: () => get({ data: { loja, accessToken: session!.access_token } }),
  });
  const salvar = useMutation({
    mutationFn: () => {
      if (!confirmado) throw new Error("Confira no painel Forecast o CNPJ e o ambiente do token.");
      return save({
        data: {
          loja,
          accessToken: session!.access_token,
          cnpj: estado.data!.cnpj_loja,
          token,
          ambiente: ambiente ?? estado.data?.ambiente_declarado ?? "homologacao",
        },
      });
    },
    onSuccess: async () => {
      setToken("");
      setAmbiente(null);
      setConfirmado(false);
      setResultado("");
      await qc.invalidateQueries({ queryKey: ["forecast-conexao", loja] });
      await qc.invalidateQueries({ queryKey: ["forecast-hml-liberacao", loja] });
      toast.success(
        "Conexão salva. Produção permanece bloqueada; revise a liberação de homologação.",
      );
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
  const ocupado = salvar.isPending || testar.isPending;
  return (
    <section className="rounded-xl border p-4 space-y-3">
      <h3 className="font-semibold">Conexão Forecast Fiscal por loja</h3>
      <p className="text-sm text-muted-foreground">
        Cadastre o token autorizado para o CNPJ desta loja. O teste consulta somente esta empresa,
        sem emitir notas ou sincronizar estoque.
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
            CNPJ: {estado.data.cnpj_loja}. Token:{" "}
            {estado.data.token_configurado ? "cadastrado (oculto)" : "não cadastrado"}.
          </p>
          {!estado.data.vinculo_atual && (
            <p role="alert">
              Salve o provedor Forecast para o CNPJ atual e configure a conexão correspondente.
            </p>
          )}
          <Label htmlFor={`forecast-ambiente-${loja}`}>
            Ambiente do token (conferido no painel)
          </Label>
          <select
            id={`forecast-ambiente-${loja}`}
            className="h-10 w-full rounded-md border bg-background px-3"
            value={ambiente ?? estado.data.ambiente_declarado ?? "homologacao"}
            disabled={!admin || ocupado}
            onChange={(e) => {
              setAmbiente(e.target.value as "homologacao" | "producao");
              setConfirmado(false);
              setResultado("");
            }}
          >
            <option value="homologacao">Homologação</option>
            <option value="producao">Produção</option>
          </select>
          <Label htmlFor={`forecast-token-${loja}`}>
            Token Forecast (vazio preserva o atual no mesmo CNPJ e ambiente)
          </Label>
          <Input
            id={`forecast-token-${loja}`}
            type="password"
            autoComplete="new-password"
            value={token}
            maxLength={2048}
            disabled={!admin || ocupado}
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
              disabled={!admin || ocupado}
              onChange={(e) => setConfirmado(e.target.checked)}
            />
            Conferi no painel Forecast que o token permite acesso ao CNPJ desta loja no ambiente
            selecionado.
          </label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!admin || !confirmado || ocupado} onClick={() => salvar.mutate()}>
              Salvar conexão Forecast
            </Button>
            <Button
              variant="outline"
              disabled={
                !admin ||
                ocupado ||
                !estado.data.vinculo_atual ||
                !estado.data.token_configurado ||
                !!token ||
                ambiente !== null
              }
              onClick={() => {
                setResultado("");
                testar.mutate();
              }}
            >
              {testar.isPending ? "Consultando..." : "Testar acesso sem emitir nota"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Somente administrador pode salvar ou testar. O ambiente é declarado: esta consulta não
            comprova homologação, certificado, série ou regras tributárias.
          </p>
          {resultado && (
            <p role="status" className="rounded-md bg-muted p-3 text-sm">
              {resultado}
            </p>
          )}
          <ForecastLiberacaoHml key={estado.data.updated_at ?? loja} loja={loja} />
        </>
      )}
    </section>
  );
}
