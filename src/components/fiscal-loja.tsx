import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import {
  validarConfiguracaoFiscal,
  pendenciasProdutoFiscal,
  selecionarCfop,
  UFS_FISCAIS,
  type ProdutoFiscal,
} from "@/lib/faznotas";

type Config = {
  serie: string;
  uf_emitente: string;
  regime: string;
  cfop_interno: string;
  cfop_interestadual: string;
  revisado_contador: boolean;
};
const vazio: Config = {
  serie: "1",
  uf_emitente: "",
  regime: "",
  cfop_interno: "",
  cfop_interestadual: "",
  revisado_contador: false,
};
export function FiscalLoja({ loja, editar }: { loja: string; editar: boolean }) {
  const { client } = useSupabase();
  const qc = useQueryClient();
  const config = useQuery({
    queryKey: ["fiscal-loja", loja],
    queryFn: async () => {
      const { data, error } = await client!
        .from("loja_fiscal_256")
        .select("*")
        .eq("centro_id", loja)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as Config | null;
    },
    enabled: !!client,
  });
  const [rascunho, setRascunho] = useState<Config | null>(null);
  const form = rascunho ?? config.data ?? vazio;
  const [cep, setCep] = useState("");
  const [uf, setUf] = useState("");
  const [produto, setProduto] = useState("");
  const [resultado, setResultado] = useState("");
  const [consultando, setConsultando] = useState(false);
  const produtos = useQuery({
    queryKey: ["fiscal-produtos", loja],
    enabled: !!client,
    queryFn: async () => {
      const lista: (ProdutoFiscal & { id: string; codigo: string; descricao: string })[] = [];
      for (let inicio = 0; ; inicio += 500) {
        const { data, error } = await client!
          .rpc("catalogo_fiscal_256", { _loja: loja })
          .range(inicio, inicio + 499);
        if (error) throw new Error(error.message);
        const pagina = (data ?? []) as typeof lista;
        lista.push(...pagina);
        if (pagina.length < 500) break;
      }
      return lista;
    },
  });
  const errosConfiguracao = validarConfiguracaoFiscal(form);
  const salvar = useMutation({
    mutationFn: async () => {
      if (errosConfiguracao.length) throw new Error(errosConfiguracao.join(" "));
      const { error } = await client!.rpc("salvar_loja_fiscal_256", {
        _loja: loja,
        _serie: form.serie,
        _uf: form.uf_emitente,
        _regime: form.regime,
        _interno: form.cfop_interno,
        _interestadual: form.cfop_interestadual,
        _revisado: form.revisado_contador,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["fiscal-loja", loja] });
      setRascunho(null);
      setResultado("");
      toast.success("Preparação fiscal salva");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  async function conferir() {
    setConsultando(true);
    setResultado("");
    try {
      const digitos = cep.replace(/\D/g, "");
      if (!/^\d{8}$/.test(digitos)) throw new Error("Informe um CEP com 8 dígitos");
      const r = await fetch(`https://viacep.com.br/ws/${digitos}/json/`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error("Consulta do CEP indisponível");
      const endereco = (await r.json()) as { erro?: boolean; uf?: string; localidade?: string };
      if (endereco.erro || !endereco.uf) throw new Error("CEP não encontrado");
      const p = produtos.data?.find((p) => p.id === produto);
      const cfop = selecionarCfop(form, endereco.uf, uf, p);
      setResultado(
        `${endereco.localidade}/${endereco.uf}: CFOP ${cfop}. Prévia para venda normal conforme as regras cadastradas; outras operações exigem enquadramento próprio.`,
      );
    } catch (e) {
      setResultado(e instanceof Error ? e.message : "Não foi possível consultar o CEP");
    } finally {
      setConsultando(false);
    }
  }
  const pendencias = (produtos.data ?? [])
    .map((p) => ({ ...p, erros: pendenciasProdutoFiscal(p) }))
    .filter((p) => p.erros.length);
  return (
    <section className="rounded-xl border p-4 space-y-4">
      <h3 className="font-semibold">NF-e · Preparação FAZNOTAS</h3>
      <p className="text-sm text-muted-foreground">
        Configure os dados com o contador. Esta etapa prepara o cadastro e confere CFOP; ainda não
        transmite notas à SEFAZ. O token da empresa será utilizado somente no servidor, na etapa de
        integração.
      </p>
      {config.error && (
        <p role="alert" className="text-destructive">
          {config.error.message}. Confira a aplicação da fase256.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Série, UF, regime e os dois CFOPs são obrigatórios para salvar. Preencha os códigos
        definidos pelo contador; nenhum código será escolhido automaticamente.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["serie", "Série NF-e"],
            ["cfop_interno", "CFOP de venda dentro da UF"],
            ["cfop_interestadual", "CFOP de venda para outra UF"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <Label htmlFor={`fiscal-${key}`}>{label}</Label>
            <Input
              id={`fiscal-${key}`}
              value={form[key]}
              required
              inputMode="numeric"
              maxLength={key === "serie" ? 3 : 4}
              aria-describedby="fiscal-validacao"
              disabled={!editar}
              onChange={(e) => {
                setRascunho({ ...form, [key]: e.target.value, revisado_contador: false });
                setResultado("");
              }}
            />
          </div>
        ))}
        <div>
          <Label htmlFor="fiscal-uf">UF do emitente</Label>
          <select
            id="fiscal-uf"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={form.uf_emitente}
            disabled={!editar}
            onChange={(e) => {
              setRascunho({ ...form, uf_emitente: e.target.value, revisado_contador: false });
              setResultado("");
            }}
          >
            <option value="">Selecione</option>
            {UFS_FISCAIS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="fiscal-crt">Regime tributário (CRT)</Label>
          <select
            id="fiscal-crt"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={form.regime}
            disabled={!editar}
            onChange={(e) =>
              setRascunho({ ...form, regime: e.target.value, revisado_contador: false })
            }
          >
            <option value="">Selecione</option>
            <option value="1">Simples Nacional</option>
            <option value="2">Simples com excesso de sublimite</option>
            <option value="3">Regime normal</option>
            <option value="4">MEI</option>
          </select>
        </div>
      </div>
      <div id="fiscal-validacao" className="text-sm text-muted-foreground" aria-live="polite">
        {errosConfiguracao.length > 0 && (
          <ul className="list-disc pl-5">
            {errosConfiguracao.map((erro) => (
              <li key={erro}>{erro}</li>
            ))}
          </ul>
        )}
      </div>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.revisado_contador}
          disabled={!editar}
          onChange={(e) => setRascunho({ ...form, revisado_contador: e.target.checked })}
        />
        Regras de venda revisadas com o contador
      </label>
      <Button
        disabled={!editar || config.isLoading || !!config.error || salvar.isPending}
        onClick={() => salvar.mutate()}
      >
        Salvar preparação fiscal
      </Button>
      <div className="border-t pt-4 space-y-3">
        <h4 className="font-medium">Conferir CFOP pelo CEP</h4>
        <p className="text-sm text-muted-foreground">
          A regra específica do produto tem prioridade. Revenda, produção própria, substituição
          tributária, devolução e exportação não usam necessariamente o mesmo CFOP.
        </p>
        <Label htmlFor="fiscal-produto">Produto (opcional)</Label>
        <select
          id="fiscal-produto"
          className="h-10 w-full rounded-md border bg-background px-3"
          value={produto}
          onChange={(e) => {
            setProduto(e.target.value);
            setResultado("");
          }}
        >
          <option value="">Regra geral da loja</option>
          {produtos.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.codigo} · {p.descricao}
            </option>
          ))}
        </select>
        <Label htmlFor="fiscal-cep">CEP do cliente</Label>
        <Input
          id="fiscal-cep"
          value={cep}
          onChange={(e) => {
            setCep(e.target.value);
            setResultado("");
          }}
        />
        <Label htmlFor="fiscal-destino">UF informada no cadastro do cliente</Label>
        <select
          id="fiscal-destino"
          className="h-10 rounded-md border bg-background px-3 ml-2"
          value={uf}
          onChange={(e) => {
            setUf(e.target.value);
            setResultado("");
          }}
        >
          <option value="">Selecione</option>
          {UFS_FISCAIS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={consultando || !form.revisado_contador}
          onClick={() => void conferir()}
        >
          {consultando ? "Consultando..." : "Conferir CFOP"}
        </Button>
        {resultado && (
          <p role="status" className="text-sm">
            {resultado}
          </p>
        )}
      </div>
      <div className="border-t pt-4 space-y-2">
        <h4 className="font-medium">Conferência fiscal do catálogo da loja</h4>
        {produtos.isLoading ? (
          <p>Conferindo produtos...</p>
        ) : produtos.error ? (
          <p role="alert" className="text-destructive">
            {produtos.error.message}
          </p>
        ) : (
          <>
            <p className="text-sm">
              {pendencias.length} de {produtos.data?.length ?? 0} produtos com pendências básicas.
              NCM e GTIN válidos não substituem a revisão da tributação.
            </p>
            <div className="max-h-72 overflow-auto">
              {pendencias.map((p) => (
                <div className="border-b py-2 text-sm" key={p.id}>
                  <strong>
                    {p.codigo} · {p.descricao}
                  </strong>
                  <p>{p.erros.join("; ")}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
