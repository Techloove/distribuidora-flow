import { useNavigate } from "@tanstack/react-router";
import { DocumentoPage, type DocumentoConfig } from "@/components/documento-page";
import { ImportarCompraXml } from "@/components/importar-compra-xml";
import { PlanejamentoCompras } from "@/components/planejamento-compras";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissoesRotinas } from "@/lib/permissoes-rotinas";
import { PackageCheck, ShoppingCart } from "lucide-react";

import { abaCompras, type AbaCompras } from "@/lib/compras";
const config: DocumentoConfig = {
  table: "compras",
  itemsTable: "compra_itens",
  parentKey: "compra_id",
  itemPriceField: "custo_unitario",
  itemPriceLabel: "Custo",
  partnerTable: "fornecedores",
  partnerKey: "fornecedor_id",
  partnerLabel: "Fornecedor",
  dateField: "data_entrada",
  dateLabel: "Data de entrada",
  rpc: "receber_compra",
  rpcLabel: "Receber compra",
  doneStatus: "recebida",
};

export function ComprasUnificadas({ aba }: { aba: AbaCompras }) {
  const perm = usePermissoesRotinas(),
    navigate = useNavigate();
  const abas = [
    {
      id: "entradas" as const,
      titulo: "Compras e entradas",
      acao: "compras_operar" as const,
      Icon: ShoppingCart,
    },
    {
      id: "planejamento" as const,
      titulo: "Planejamento e reposição",
      acao: "compras_planejar" as const,
      Icon: PackageCheck,
    },
  ].filter((a) => perm.pode(a.acao));
  const selecionada = abas.some((a) => a.id === aba) ? aba : abas[0]?.id;
  if (!selecionada)
    return (
      <p role="status" className="rounded-xl border p-5">
        {perm.carregando
          ? "Verificando acesso…"
          : "Nenhuma rotina de compras foi liberada para seu perfil. Solicite ao administrador."}
      </p>
    );
  return (
    <Tabs
      value={selecionada}
      onValueChange={(value) =>
        void navigate({ to: "/compras", search: { aba: abaCompras(value) }, replace: true })
      }
      className="space-y-5"
    >
      <section
        className={`rounded-xl border bg-card p-4 space-y-3 ${selecionada === "planejamento" ? "no-print" : ""}`}
      >
        {selecionada !== "planejamento" && (
          <>
            <h2 className="font-semibold">Da reposição à entrada de mercadorias</h2>
            <p className="text-sm text-muted-foreground">
              Planeje o abastecimento e acompanhe as compras em um só lugar. O estoque e as contas a
              pagar são atualizados ao receber a compra.
            </p>
          </>
        )}
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
          {abas.map(({ id, titulo, Icon }) => (
            <TabsTrigger key={id} value={id} className="gap-2">
              <Icon className="size-4" />
              {titulo}
            </TabsTrigger>
          ))}
        </TabsList>
      </section>
      {perm.pode("compras_operar") && (
        <TabsContent value="entradas">
          <ImportarCompraXml />
          <DocumentoPage config={config} />
        </TabsContent>
      )}
      {perm.pode("compras_planejar") && (
        <TabsContent value="planejamento">
          <PlanejamentoCompras />
        </TabsContent>
      )}
    </Tabs>
  );
}
