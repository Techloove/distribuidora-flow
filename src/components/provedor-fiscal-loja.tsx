import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import { ForecastConexao } from "./forecast-conexao";

type Estado = {
  provedor: "forecastfiscal" | "suspenso";
  cnpj_loja: string;
  cnpj_vinculado: string | null;
  vinculo_atual: boolean | null;
  emissao_disponivel: false;
};
export function ProvedorFiscalLoja({ loja }: { loja: string }) {
  const { client, roles } = useSupabase();
  const qc = useQueryClient();
  const [provedor, setProvedor] = useState<Estado["provedor"] | null>(null);
  const estado = useQuery({
    queryKey: ["provedor-fiscal", loja],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!.rpc("estado_provedor_fiscal_261", { _loja: loja });
      if (error) throw new Error(error.message);
      return data as Estado;
    },
  });
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc("salvar_provedor_fiscal_261", {
        _loja: loja,
        _provedor: provedor ?? estado.data?.provedor ?? "forecastfiscal",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["provedor-fiscal", loja] });
      await qc.invalidateQueries({ queryKey: ["forecast-conexao", loja] });
      await qc.invalidateQueries({ queryKey: ["forecast-hml-liberacao", loja] });
      setProvedor(null);
      toast.success(
        "Preferência fiscal salva. Produção permanece bloqueada; confira a homologação.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const admin = roles.includes("admin");
  return (
    <section className="rounded-xl border p-4 space-y-3">
      <h3 className="font-semibold">Provedor fiscal da loja</h3>
      <p className="text-sm text-muted-foreground">
        Cada loja mantém seu CNPJ e suas regras fiscais. A conexão Forecast consulta a empresa
        correspondente sem alterar documentos anteriores ou os estoques das lojas.
      </p>
      {estado.error && (
        <p role="alert" className="text-destructive">
          {estado.error.message}. Confira a fase261.
        </p>
      )}
      {estado.data && (
        <p className="text-sm">CNPJ da loja: {estado.data.cnpj_loja || "Não informado"}</p>
      )}
      {estado.data?.cnpj_vinculado && !estado.data.vinculo_atual && (
        <p role="alert" className="text-destructive">
          O CNPJ da loja mudou. Revise e salve novamente o vínculo fiscal.
        </p>
      )}
      <Label htmlFor={`provedor-${loja}`}>Provedor para novas emissões</Label>
      <select
        id={`provedor-${loja}`}
        className="h-10 w-full rounded-md border bg-background px-3"
        value={provedor ?? estado.data?.provedor ?? "forecastfiscal"}
        disabled={!admin || !estado.data || salvar.isPending}
        onChange={(e) => setProvedor(e.target.value as Estado["provedor"])}
      >
        <option value="forecastfiscal">Forecast Fiscal · API principal</option>
        <option value="suspenso">Emissão por API suspensa</option>
      </select>
      <p className="rounded-lg bg-muted p-3 text-sm">
        Produção bloqueada. Configure a conexão e habilite os testes de envio exclusivamente em
        homologação após conferir o ambiente e as regras fiscais desta loja.
      </p>
      <Button
        disabled={!admin || !estado.data || !!estado.error || salvar.isPending}
        onClick={() => salvar.mutate()}
      >
        Salvar provedor da loja
      </Button>
      {estado.data?.provedor === "forecastfiscal" && <ForecastConexao key={loja} loja={loja} />}
    </section>
  );
}
