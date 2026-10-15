import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RomaneiosEntrega } from "@/components/romaneios-entrega";
import { ErpLayout } from "@/components/erp-layout";
import { Entregas } from "@/components/entregas";
export const Route = createFileRoute("/_app/entregas")({
  head: () => ({ meta: [{ title: "Entregas — Caparaó System" }] }),
  component: () => (
    <ErpLayout
      title="Entregas"
      description="Formalize o recebimento dos pedidos e acompanhe as entregas concluídas."
    >
      <Tabs defaultValue="entregas" className="space-y-5">
        <TabsList className="h-auto flex flex-wrap justify-start">
          <TabsTrigger value="entregas">Entregas</TabsTrigger>
          <TabsTrigger value="romaneios">Romaneios e ocorrências</TabsTrigger>
        </TabsList>
        <TabsContent value="entregas">
          <Entregas />
        </TabsContent>
        <TabsContent value="romaneios">
          <RomaneiosEntrega />
        </TabsContent>
      </Tabs>
    </ErpLayout>
  ),
});
