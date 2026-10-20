import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useSupabase } from "@/lib/supabase-provider";
import { logoLojaValida } from "@/lib/identidade-loja";
export function LogoLoja({
  valor,
  onChange,
}: {
  valor: unknown;
  onChange: (valor: string) => void;
}) {
  const { canManage } = useSupabase();
  const [erro, setErro] = useState("");
  const src = logoLojaValida(valor);
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <Label htmlFor="endereco-logo-loja">Endereço da logo (opcional)</Label>
      <Input
        id="endereco-logo-loja"
        type="url"
        placeholder="https://..."
        disabled={!canManage}
        value={typeof valor === "string" && !valor.startsWith("data:") ? valor : ""}
        onChange={(e) => onChange(e.target.value)}
      />
      <Label htmlFor="arquivo-logo-loja">Enviar logo da loja</Label>
      <Input
        id="arquivo-logo-loja"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={!canManage}
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          setErro("");
          if (!arquivo) return;
          if (
            !["image/png", "image/jpeg", "image/webp"].includes(arquivo.type) ||
            arquivo.size > 200 * 1024
          ) {
            setErro("Escolha PNG, JPEG ou WebP de até 200 KB.");
            e.target.value = "";
            return;
          }
          const leitor = new FileReader();
          leitor.onerror = () => setErro("Não foi possível ler a imagem.");
          leitor.onload = () => {
            const logo = logoLojaValida(leitor.result);
            if (logo) onChange(logo);
            else setErro("Formato de imagem inválido.");
          };
          leitor.readAsDataURL(arquivo);
        }}
      />
      <p className="text-xs text-muted-foreground">
        PNG, JPEG ou WebP de até 200 KB. Você também pode informar um endereço HTTPS no campo de
        logo. Salve o cadastro para aplicar.
      </p>
      {src && (
        <img
          src={src}
          alt="Prévia da logo da loja"
          className="max-h-24 max-w-full object-contain"
          referrerPolicy="no-referrer"
        />
      )}
      {src && canManage && (
        <Button type="button" variant="outline" onClick={() => onChange("")}>
          Remover logo
        </Button>
      )}
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}
