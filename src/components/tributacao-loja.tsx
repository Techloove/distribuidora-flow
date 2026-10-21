import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSupabase } from "@/lib/supabase-provider";
import { pendenciasProdutoFiscal, UFS_FISCAIS, type ProdutoFiscal } from "@/lib/faznotas";
import {
  CAMPOS_CBS,
  CAMPOS_ICMS,
  CSOSN,
  CST_ICMS,
  pendenciasTributacao,
  prepararProdutoFaznotas,
  tributosSchema,
  type EstadoIcms,
  type TributosConfig,
} from "@/lib/faznotas-tributos";

type Produto = ProdutoFiscal & { id: string; codigo: string; descricao: string };
type Regra = {
  cfop: string;
  configuracoes: TributosConfig;
  aceita_padrao_ibs_cbs: boolean;
  revisado_contador: boolean;
  revisao_valida: boolean;
  updated_at: string;
};
type ConfigLoja = {
  uf_emitente: string;
  regime: string;
  cfop_interno: string;
  cfop_interestadual: string;
  revisado_contador: boolean;
};
export function TributacaoLoja({ loja, editar }: { loja: string; editar: boolean }) {
  const { client } = useSupabase();
  const [produto, setProduto] = useState("");
  const [selecionada, setSelecionada] = useState("nova");
  const [busca, setBusca] = useState("");
  const catalogo = useQuery({
    queryKey: ["fiscal-produtos", loja],
    enabled: !!client,
    queryFn: async () => {
      const lista: Produto[] = [];
      for (let inicio = 0; ; inicio += 500) {
        const { data, error } = await client!
          .rpc("catalogo_fiscal_256", { _loja: loja })
          .range(inicio, inicio + 499);
        if (error) throw new Error(error.message);
        lista.push(...((data ?? []) as Produto[]));
        if ((data ?? []).length < 500) break;
      }
      return lista;
    },
  });
  const config = useQuery({
    queryKey: ["fiscal-loja", loja],
    enabled: !!client,
    queryFn: async () => {
      const { data, error } = await client!
        .from("loja_fiscal_256")
        .select("*")
        .eq("centro_id", loja)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as ConfigLoja | null;
    },
  });
  const regras = useQuery({
    queryKey: ["tributacao-produto", loja, produto],
    enabled: !!client && !!produto,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      const { data, error } = await client!.rpc("listar_tributacao_produto_258", {
        _loja: loja,
        _produto: produto,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as Regra[];
    },
  });
  const selecionado = catalogo.data?.find((p) => p.id === produto);
  const regra = regras.data?.find((r) => r.cfop === selecionada);
  return (
    <section className="rounded-xl border p-4 space-y-4">
      <h3 className="font-semibold">Tributação dos produtos · FAZNOTAS</h3>
      <p className="text-sm text-muted-foreground">
        Regras específicas desta loja por produto e CFOP, com ICMS por UF de destino. Preencha
        conforme a orientação do contador. Salvar estas regras não transmite produtos ou notas à
        API.
      </p>
      <Button
        variant="outline"
        disabled={regras.isFetching || catalogo.isFetching}
        onClick={() => {
          void Promise.all([
            catalogo.refetch(),
            config.refetch(),
            ...(produto ? [regras.refetch()] : []),
          ]);
        }}
      >
        Recarregar dados e regras salvas
      </Button>
      <Label htmlFor="tributacao-busca">Buscar produto por código ou descrição</Label>
      <Input id="tributacao-busca" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <Label htmlFor="tributacao-produto">Produto do catálogo da loja</Label>
      <select
        id="tributacao-produto"
        className="h-10 w-full rounded-md border bg-background px-3"
        value={produto}
        onChange={(e) => {
          setProduto(e.target.value);
          setSelecionada("nova");
        }}
      >
        <option value="">Selecione</option>
        {catalogo.data
          ?.filter(
            (p) =>
              p.id === produto ||
              `${p.codigo} ${p.descricao}`.toLocaleLowerCase().includes(busca.toLocaleLowerCase()),
          )
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.codigo} · {p.descricao}
            </option>
          ))}
      </select>
      {(catalogo.error || config.error || regras.error) && (
        <p role="alert" className="text-destructive">
          {catalogo.error?.message || config.error?.message || regras.error?.message}. Confira a
          fase258 no Supabase.
        </p>
      )}
      {produto && (config.isLoading || regras.isLoading) && <p>Carregando parametrização...</p>}
      {produto && !config.isLoading && !config.data && !config.error && (
        <p>Salve primeiro a preparação fiscal da loja, no bloco acima.</p>
      )}
      {selecionado && config.data && !regras.isLoading && !regras.error && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selecionada === "nova" ? "default" : "outline"}
              onClick={() => setSelecionada("nova")}
            >
              Nova regra de CFOP
            </Button>
            {regras.data?.map((r) => (
              <Button
                key={r.cfop}
                variant={selecionada === r.cfop ? "default" : "outline"}
                onClick={() => setSelecionada(r.cfop)}
              >
                {r.cfop} ·{" "}
                {r.revisao_valida
                  ? "Revisado"
                  : r.revisado_contador
                    ? "Revisar alterações"
                    : "Rascunho"}
              </Button>
            ))}
          </div>
          <EditorTributacao
            key={`${produto}:${selecionada}:${regra?.updated_at ?? "nova"}`}
            loja={loja}
            produto={selecionado}
            configLoja={config.data}
            regra={regra}
            regras={regras.data ?? []}
            editar={editar}
            onSalvo={setSelecionada}
          />
        </>
      )}
    </section>
  );
}

const CAMPOS_PIS = [
  ["pis-cst", "CST PIS"],
  ["pis-aliquota", "PIS (%)"],
  ["cofins-cst", "CST COFINS"],
  ["cofins-aliquota", "COFINS (%)"],
] as const;
function EditorTributacao({
  loja,
  produto,
  configLoja,
  regra,
  regras,
  editar,
  onSalvo,
}: {
  loja: string;
  produto: Produto;
  configLoja: ConfigLoja;
  regra?: Regra | undefined;
  regras: Regra[];
  editar: boolean;
  onSalvo: (cfop: string) => void;
}) {
  const { client } = useSupabase();
  const qc = useQueryClient();
  const inicial = regra?.configuracoes;
  const [cfop, setCfop] = useState(regra?.cfop ?? "");
  const [estados, setEstados] = useState<EstadoIcms[]>(
    (inicial?.icms?.estados ?? []) as EstadoIcms[],
  );
  const [novaUf, setNovaUf] = useState("");
  const [pis, setPis] = useState<Record<string, string>>(
    (inicial?.["pis-cofins"] ?? {}) as Record<string, string>,
  );
  const [ipiAtivo, setIpiAtivo] = useState(!!inicial?.ipi);
  const [ipi, setIpi] = useState<Record<string, string>>(
    (inicial?.ipi ?? {}) as Record<string, string>,
  );
  const [cbsAtivo, setCbsAtivo] = useState(!!inicial?.["cbs-ibs"]);
  const [cbs, setCbs] = useState<Record<string, string>>({
    "cbs-ibs-cst": inicial?.["cbs-ibs"]?.["cbs-ibs-cst"] ?? "",
    classificacao: inicial?.["cbs-ibs"]?.classificacao ?? "",
  });
  const [aliquotasCbs, setAliquotasCbs] = useState<Record<string, string>>(
    (inicial?.["cbs-ibs"]?.aliquotas ?? {}) as Record<string, string>,
  );
  const [aceitaPadrao, setAceitaPadrao] = useState(regra?.aceita_padrao_ibs_cbs ?? false);
  const [revisado, setRevisado] = useState(false);
  const [preview, setPreview] = useState("");
  function alterou() {
    setRevisado(false);
    setPreview("");
  }
  const limpo = (v: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(v)
        .filter(([, value]) => value.trim() !== "")
        .map(([key, value]) => [key, value.trim()]),
    );
  const config = {
    ...(estados.length
      ? {
          icms: {
            estados: estados.map((e) => ({
              ...e,
              ...(e.aliquotas ? { aliquotas: limpo(e.aliquotas) } : {}),
            })),
          },
        }
      : {}),
    ...(Object.keys(limpo(pis)).length ? { "pis-cofins": limpo(pis) } : {}),
    ...(ipiAtivo ? { ipi: limpo(ipi) } : {}),
    ...(cbsAtivo ? { "cbs-ibs": { ...limpo(cbs), aliquotas: limpo(aliquotasCbs) } } : {}),
  };
  const parsed = tributosSchema.safeParse(config);
  const pendenciasTributos = parsed.success
    ? pendenciasTributacao(
        parsed.data,
        cfop,
        configLoja.uf_emitente,
        configLoja.regime,
        aceitaPadrao,
      )
    : parsed.error.issues.map((i) => `${i.path.join(" → ")}: ${i.message}`);
  const pendencias = [...pendenciasProdutoFiscal(produto), ...pendenciasTributos];
  const salvar = useMutation({
    mutationFn: async () => {
      if (!/^[56]\d{3}$/.test(cfop))
        throw new Error("Informe CFOP com 4 dígitos, começando com 5 ou 6");
      if (!regra && regras.some((r) => r.cfop === cfop))
        throw new Error("Esse CFOP já existe. Selecione a regra cadastrada para editá-la");
      if (!parsed.success) throw new Error("Revise os campos tributários indicados abaixo");
      if (revisado && pendencias.length)
        throw new Error("Resolva as pendências antes de marcar a revisão");
      const { error } = await client!.rpc("salvar_tributacao_produto_258", {
        _loja: loja,
        _produto: produto.id,
        _cfop: cfop,
        _config: parsed.data,
        _revisado: revisado,
        _aceita_padrao: aceitaPadrao,
        _versao: regra?.updated_at ?? null,
        _contexto_produto: {
          codigo: String(produto.codigo),
          descricao: produto.descricao,
          ncm: produto.ncm ?? null,
          cest: produto.cest ?? null,
          ean: produto.ean ?? null,
          unidade: produto.unidade ?? null,
          origem: produto.origem_fiscal ?? null,
          cfop: produto.cfop ?? null,
          cfop_interestadual: produto.cfop_interestadual ?? null,
        },
        _contexto_loja: {
          uf: configLoja.uf_emitente,
          crt: configLoja.regime,
          cfop_interno: configLoja.cfop_interno,
          cfop_interestadual: configLoja.cfop_interestadual,
          revisado: configLoja.revisado_contador,
        },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tributacao-produto", loja, produto.id] });
      onSalvo(cfop);
      toast.success(revisado ? "Tributação revisada e salva" : "Rascunho tributário salvo");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const codigosIcms = ["1", "4"].includes(configLoja.regime) ? CSOSN : CST_ICMS;
  const destinos = UFS_FISCAIS.filter(
    (uf) =>
      !estados.some((e) => e.estado === uf) &&
      (cfop.startsWith("5")
        ? uf === configLoja.uf_emitente
        : cfop.startsWith("6")
          ? uf !== configLoja.uf_emitente
          : true),
  );
  function campo(key: string, label: string, value: string, set: (value: string) => void) {
    return (
      <div key={key}>
        <Label htmlFor={`tax-${key}`}>{label}</Label>
        <Input
          id={`tax-${key}`}
          value={value}
          disabled={!editar || salvar.isPending}
          onChange={(e) => {
            set(e.target.value.replace(",", "."));
            alterou();
          }}
        />
      </div>
    );
  }
  return (
    <div className="rounded-lg border p-4 space-y-4">
      {regra?.revisado_contador && !regra.revisao_valida && (
        <p role="alert" className="text-destructive">
          Dados fiscais do produto ou da loja mudaram desde a revisão. Confira esta regra novamente
          antes de utilizá-la.
        </p>
      )}
      <Label htmlFor="tributacao-cfop">CFOP desta regra</Label>
      <Input
        id="tributacao-cfop"
        inputMode="numeric"
        maxLength={4}
        value={cfop}
        disabled={!editar || !!regra || salvar.isPending}
        onChange={(e) => {
          setCfop(e.target.value.replace(/\D/g, ""));
          alterou();
        }}
      />
      <p className="text-sm text-muted-foreground">
        Emitente {configLoja.uf_emitente} · CRT {configLoja.regime}. CFOP 5xxx: mesma UF. CFOP 6xxx:
        outra UF. Campos de percentual vazios são omitidos; zero deve ser informado expressamente
        quando aplicável.
      </p>
      <div className="space-y-3 border-t pt-4">
        <h4 className="font-medium">ICMS por UF de destino</h4>
        <div className="flex flex-wrap gap-2">
          <Label htmlFor="tributacao-nova-uf">Adicionar UF</Label>
          <select
            id="tributacao-nova-uf"
            className="h-10 rounded-md border bg-background px-3"
            value={novaUf}
            disabled={!editar || salvar.isPending}
            onChange={(e) => setNovaUf(e.target.value)}
          >
            <option value="">Selecione</option>
            {destinos.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          <Button
            variant="outline"
            disabled={!editar || !novaUf || !destinos.includes(novaUf) || salvar.isPending}
            onClick={() => {
              setEstados([...estados, { estado: novaUf, "icms-cst": "" }]);
              setNovaUf("");
              alterou();
            }}
          >
            Adicionar
          </Button>
        </div>
        {estados.map((estado, index) => {
          const patch = (v: Partial<EstadoIcms>) => {
            setEstados(estados.map((e, i) => (i === index ? { ...e, ...v } : e)));
            alterou();
          };
          return (
            <details
              className="rounded-lg border p-3"
              key={estado.estado}
              open={estados.length === 1 || !estado["icms-cst"]}
            >
              <summary className="cursor-pointer font-medium">
                {estado.estado} · {estado["icms-cst"] || "Informe CST/CSOSN"}
              </summary>
              <div className="grid gap-3 sm:grid-cols-2 mt-3">
                <div>
                  <Label htmlFor={`icms-cst-${estado.estado}`}>
                    {["1", "4"].includes(configLoja.regime) ? "CSOSN" : "CST ICMS"}
                  </Label>
                  <select
                    id={`icms-cst-${estado.estado}`}
                    className="h-10 w-full rounded-md border bg-background px-3"
                    value={estado["icms-cst"]}
                    disabled={!editar || salvar.isPending}
                    onChange={(e) => patch({ "icms-cst": e.target.value })}
                  >
                    <option value="">Selecione</option>
                    {codigosIcms.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`icms-mod-${estado.estado}`}>Modalidade da base de cálculo</Label>
                  <select
                    id={`icms-mod-${estado.estado}`}
                    className="h-10 w-full rounded-md border bg-background px-3"
                    value={estado["modalidade-base-calculo"] ?? ""}
                    disabled={!editar || salvar.isPending}
                    onChange={(e) =>
                      patch({
                        "modalidade-base-calculo": e.target.value
                          ? (e.target.value as EstadoIcms["modalidade-base-calculo"])
                          : undefined,
                      })
                    }
                  >
                    <option value="">Não informar</option>
                    {["0", "1", "2", "3", "4", "5"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                {CAMPOS_ICMS.map(([key, label]) =>
                  campo(`${estado.estado}-${key}`, label, estado.aliquotas?.[key] ?? "", (value) =>
                    patch({
                      aliquotas: {
                        ...estado.aliquotas,
                        [key]: key === "codigo-beneficiario" ? value.toUpperCase() : value,
                      },
                    }),
                  ),
                )}
              </div>
              <Button
                className="mt-3"
                variant="outline"
                disabled={!editar || salvar.isPending}
                onClick={() => {
                  setEstados(estados.filter((_, i) => i !== index));
                  alterou();
                }}
              >
                Remover UF desta regra
              </Button>
            </details>
          );
        })}
      </div>
      <div className="border-t pt-4 space-y-3">
        <h4 className="font-medium">PIS / COFINS</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {CAMPOS_PIS.map(([key, label]) =>
            campo(key, label, pis[key] ?? "", (value) => setPis({ ...pis, [key]: value })),
          )}
        </div>
      </div>
      <div className="border-t pt-4 space-y-3">
        <label className="flex gap-2 font-medium">
          <input
            type="checkbox"
            checked={ipiAtivo}
            disabled={!editar || salvar.isPending}
            onChange={(e) => {
              setIpiAtivo(e.target.checked);
              alterou();
            }}
          />
          Informar IPI
        </label>
        {ipiAtivo && (
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("ipi-cst", "CST IPI", ipi["ipi-cst"] ?? "", (value) =>
              setIpi({ ...ipi, "ipi-cst": value }),
            )}
            {campo("ipi-aliquota", "IPI (%)", ipi["ipi-aliquota"] ?? "", (value) =>
              setIpi({ ...ipi, "ipi-aliquota": value }),
            )}
          </div>
        )}
      </div>
      <div className="border-t pt-4 space-y-3">
        <label className="flex gap-2 font-medium">
          <input
            type="checkbox"
            checked={cbsAtivo}
            disabled={!editar || salvar.isPending}
            onChange={(e) => {
              setCbsAtivo(e.target.checked);
              setAceitaPadrao(false);
              alterou();
            }}
          />
          Configurar IBS / CBS
        </label>
        {cbsAtivo ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("cbs-ibs-cst", "CST IBS/CBS (3 dígitos)", cbs["cbs-ibs-cst"] ?? "", (value) =>
              setCbs({ ...cbs, "cbs-ibs-cst": value }),
            )}
            {campo(
              "classificacao",
              "Classificação tributária (6 dígitos)",
              cbs["classificacao"] ?? "",
              (value) => setCbs({ ...cbs, classificacao: value }),
            )}
            {CAMPOS_CBS.map(([key, label]) =>
              campo(key, label, aliquotasCbs[key] ?? "", (value) =>
                setAliquotasCbs({ ...aliquotasCbs, [key]: value }),
              ),
            )}
          </div>
        ) : (
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={aceitaPadrao}
              disabled={!editar || salvar.isPending}
              onChange={(e) => {
                setAceitaPadrao(e.target.checked);
                alterou();
              }}
            />
            O contador confirmou a omissão deste bloco e o uso dos padrões da FAZNOTAS: CST 000,
            classificação 000001, CBS 0,9% e IBS 0,1%, conforme a documentação recebida.
          </label>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        O sistema valida formato, UF e coerência do CST/CSOSN com o CRT. A aplicabilidade dos
        impostos, benefícios e alíquotas precisa ser definida pelo contador. Campos omitidos podem
        receber padrões do provedor.
      </p>
      {pendencias.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Para revisar a regra:</p>
          <ul className="list-disc pl-5">
            {pendencias.map((p, i) => (
              <li key={`${i}-${p}`}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={revisado}
          disabled={
            !editar || salvar.isPending || pendencias.length > 0 || !configLoja.revisado_contador
          }
          onChange={(e) => setRevisado(e.target.checked)}
        />
        Revisei esta parametrização com o contador. Toda alteração exige nova confirmação.
      </label>
      {!configLoja.revisado_contador && (
        <p className="text-sm text-destructive">
          A preparação fiscal da loja ainda precisa ser revisada.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!editar || salvar.isPending} onClick={() => salvar.mutate()}>
          {salvar.isPending
            ? "Salvando..."
            : revisado
              ? "Salvar regra revisada"
              : "Salvar como rascunho"}
        </Button>
        <Button
          variant="outline"
          disabled={!regra?.revisao_valida || salvar.isPending}
          onClick={() => {
            try {
              setPreview(JSON.stringify(prepararProdutoFaznotas(produto, [regra!]), null, 2));
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Confira o produto");
            }
          }}
        >
          Conferir JSON salvo deste CFOP
        </Button>
      </div>
      {preview && (
        <details open>
          <summary className="cursor-pointer text-sm font-medium">
            Prévia do cadastro de produto (sem envio)
          </summary>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{preview}</pre>
        </details>
      )}
    </div>
  );
}
