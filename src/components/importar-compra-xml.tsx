import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { lerXmlCompra, type XmlCompra } from "@/lib/importacoes-distribuidora";
import { useCentroValido } from "@/lib/centros-acesso";
import { useSupabase } from "@/lib/supabase-provider";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { useRotinaRpc } from "@/lib/use-rotina-rpc";
import { lerPaginas } from "@/lib/paginacao";
import { brl } from "@/lib/formatacao";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { Registro } from "@/lib/rotinas-distribuidora";
export function ImportarCompraXml() {
  const { client, user } = useSupabase(),
    { centro } = useCentroValido(),
    perm = usePermissoesRotinas(),
    rpc = useRotinaRpc(["compras"]);
  const [xml, setXml] = useState<XmlCompra | null>(null),
    [fornecedor, setFornecedor] = useState(""),
    [mapa, setMapa] = useState<Record<number, { produto: string; fator: string }>>({}),
    [conferido, setConferido] = useState(false);
  const q = useQuery({
    queryKey: ["xml-opcoes", user?.id],
    enabled: !!client && perm.pode("compra_xml_importar"),
    queryFn: async () => {
      const [produtos, fornecedores] = await Promise.all([
        lerPaginas<Registro>((inicio, fim) =>
          client!
            .from("produtos")
            .select("id,descricao,unidade")
            .eq("ativo", true)
            .order("descricao")
            .order("id")
            .range(inicio, fim),
        ),
        lerPaginas<Registro>((inicio, fim) =>
          client!
            .from("fornecedores")
            .select("id,razao_social,cnpj_cpf")
            .order("razao_social")
            .order("id")
            .range(inicio, fim),
        ),
      ]);
      return { produtos, fornecedores };
    },
  });
  const importar = () => {
    if (!xml) return;
    const soma = xml.itens.reduce((s, i) => s + i.valor, 0);
    const itens = xml.itens.map((i, n) => {
      const m = mapa[n],
        fator = Number(m?.fator ?? 1),
        quantidade = i.quantidade * fator;
      if (!m?.produto || !Number.isFinite(fator) || fator <= 0)
        throw new Error("Mapeie todos os produtos e fatores de conversão.");
      return {
        produto_id: m.produto,
        quantidade,
        custo_unitario: (i.valor + (soma > 0 ? (xml.extras * i.valor) / soma : 0)) / quantidade,
      };
    });
    rpc.mutate(
      {
        nome: "importar_compra_xml_218",
        args: {
          _fornecedor: fornecedor,
          _centro: centro,
          _dados: { ...xml, conferido },
          _itens: itens,
        },
      },
      {
        onSuccess: () => {
          setXml(null);
          setConferido(false);
          toast.success(
            "Compra em rascunho. Confira parcelas, forma de pagamento e os custos antes de receber.",
          );
        },
      },
    );
  };
  if (!perm.pode("compra_xml_importar")) return null;
  return (
    <details className="mb-4 rounded border bg-card p-4 space-y-3">
      <summary className="cursor-pointer font-semibold">Importar XML de compra</summary>
      <p className="text-xs text-muted-foreground">
        Não emite NF-e. O XML preenche um rascunho; estoque e financeiro só mudam ao receber a
        compra. Confira fornecedor, unidades e conversões. A assinatura fiscal não é validada pelo
        leitor.
      </p>
      {q.error && <p role="alert">{q.error.message}</p>}
      <Input
        type="file"
        aria-label="XML da compra"
        accept=".xml,application/xml,text/xml"
        disabled={rpc.isPending}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          setXml(null);
          setMapa({});
          setConferido(false);
          if (!f) return;
          try {
            if (f.size > 5_000_000) throw new Error("XML acima de 5 MB.");
            setXml(lerXmlCompra(await f.text()));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "XML inválido");
          }
        }}
      />
      {xml && (
        <>
          <p className="text-sm">
            {xml.nome} · NF {xml.numero} · {brl(xml.total)} · frete {brl(xml.frete)} ·
            despesas/IPI/ST {brl(xml.extras)}
          </p>
          <p className="text-xs break-all">Chave: {xml.chave}</p>
          <label className="text-sm">
            Fornecedor
            <select
              className="block w-full rounded border bg-background p-2"
              aria-label="Fornecedor do XML"
              value={fornecedor}
              onChange={(e) => {
                setFornecedor(e.target.value);
                setConferido(false);
              }}
            >
              <option value="">Selecione o cadastro correspondente</option>
              {q.data?.fornecedores.map((f) => (
                <option key={String(f["id"])} value={String(f["id"])}>
                  {String(f["razao_social"])} · {String(f["cnpj_cpf"] ?? "")}
                </option>
              ))}
            </select>
          </label>
          {xml.itens.map((i, n) => (
            <div key={n} className="grid gap-2 sm:grid-cols-3 border-b py-2">
              <span className="text-sm">
                {i.codigo} · {i.descricao} · {i.quantidade} {i.unidade}
              </span>
              <select
                aria-label={`Produto para ${i.codigo}`}
                className="rounded border bg-background p-2"
                value={mapa[n]?.produto ?? ""}
                onChange={(e) => {
                  setMapa((s) => ({
                    ...s,
                    [n]: { produto: e.target.value, fator: s[n]?.fator ?? "1" },
                  }));
                  setConferido(false);
                }}
              >
                <option value="">Associe ao produto do ERP</option>
                {q.data?.produtos.map((p) => (
                  <option key={String(p["id"])} value={String(p["id"])}>
                    {String(p["descricao"])} · {String(p["unidade"])}
                  </option>
                ))}
              </select>
              <label className="text-xs">
                Unidades do ERP por unidade do XML
                <Input
                  aria-label={`Conversão para ${i.codigo}`}
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={mapa[n]?.fator ?? "1"}
                  onChange={(e) => {
                    setMapa((s) => ({
                      ...s,
                      [n]: { produto: s[n]?.produto ?? "", fator: e.target.value },
                    }));
                    setConferido(false);
                  }}
                />
              </label>
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={conferido}
              onChange={(e) => setConferido(e.target.checked)}
            />
            Conferi fornecedor, produtos, unidades e custos
          </label>
          <Button
            disabled={
              !centro || !fornecedor || !conferido || rpc.isPending || q.isPending || q.isError
            }
            onClick={() => {
              try {
                importar();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Itens inválidos");
              }
            }}
          >
            Importar como rascunho
          </Button>
          {!centro && <p className="text-sm">Selecione um centro antes de importar.</p>}
          <p className="text-xs text-muted-foreground">
            Extras do XML são rateados no custo dos itens. Frete e desconto ficam no cabeçalho e
            integram o custo de aquisição ao receber.
          </p>
        </>
      )}
    </details>
  );
}
