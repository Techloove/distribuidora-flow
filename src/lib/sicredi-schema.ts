import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
export const boletoReferenceSchema = z.object({ nossoNumero: text(40).regex(/^[a-zA-Z0-9-]+$/) });
export const emitirBoletoSchema = z.object({
  contaReceberId: z.string().uuid(),
  seuNumero: text(50),
  valor: z.number().finite().positive().max(999999999),
  vencimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => {
      const d = new Date(`${v}T12:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    }, "Data inválida"),
  pagador: z.object({
    tipoPessoa: z.enum(["PESSOA_FISICA", "PESSOA_JURIDICA"]),
    documento: text(20)
      .transform((v) => v.replace(/\D/g, ""))
      .refine((v) => v.length === 11 || v.length === 14),
    nome: text(200),
    endereco: text(200),
    cidade: text(100),
    uf: z.string().length(2),
    cep: text(10)
      .transform((v) => v.replace(/\D/g, ""))
      .pipe(z.string().length(8)),
    telefone: z.string().max(30).optional(),
    email: z.string().email().max(254).optional(),
  }),
  informativo: z.string().max(500).optional(),
  diasProtesto: z.number().int().min(0).max(365).optional(),
  juros: z.number().finite().min(0).max(100).optional(),
  multa: z.number().finite().min(0).max(100).optional(),
});
