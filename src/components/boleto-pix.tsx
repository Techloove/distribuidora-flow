import { useMemo } from "react";
import qrcode from "qrcode-generator";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function BoletoPix({ payload, txid }: { payload: string; txid: string }) {
  const image = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(payload, "Byte");
    qr.make();
    return qr.createDataURL(4, 16);
  }, [payload]);
  return (
    <details className="text-left">
      <summary className="cursor-pointer text-sm">QR Code PIX</summary>
      <div className="my-2 flex max-w-xs flex-col items-start gap-2 rounded-md border bg-background p-3">
        <img
          src={image}
          alt="QR Code PIX do boleto"
          width={244}
          height={244}
          className="h-auto max-w-full"
        />
        <span className="break-all text-xs">TXID: {txid}</span>
        <textarea
          aria-label="PIX copia e cola"
          readOnly
          value={payload}
          className="h-20 w-full rounded border p-2 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(payload);
              toast.success("Código PIX copiado.");
            } catch {
              toast.error("Selecione e copie o código PIX no campo acima.");
            }
          }}
        >
          Copiar código PIX
        </Button>
      </div>
    </details>
  );
}
