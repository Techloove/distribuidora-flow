export const ETAPAS_PEDIDO = [
  "Elaboração",
  "Aprovação",
  "Confirmado",
  "Separação",
  "Pronto para carga",
  "Carga montada",
  "Em rota de entrega",
  "Entregue",
] as const;
type SituacaoPedido = { nome: string; etapa: number | null; descricao: string; atencao?: boolean };
const SITUACOES: Record<string, SituacaoPedido> = {
  rascunho: {
    nome: "Em elaboração",
    etapa: 0,
    descricao: "Pedido em preenchimento, ainda sem confirmação.",
  },
  digitacao: {
    nome: "Em elaboração",
    etapa: 0,
    descricao: "Pedido em preenchimento, ainda sem confirmação.",
  },
  aguardando_aprovacao: {
    nome: "Aguardando aprovação",
    etapa: 1,
    descricao: "Pedido enviado para análise e aprovação.",
  },
  aprovado: {
    nome: "Aprovado",
    etapa: 1,
    descricao: "Aprovado e aguardando a confirmação da venda.",
  },
  confirmado: {
    nome: "Confirmado",
    etapa: 2,
    descricao: "Venda confirmada, aguardando início da separação.",
  },
  separacao: {
    nome: "Em separação",
    etapa: 3,
    descricao: "Os produtos estão sendo separados para o pedido.",
  },
  separado: {
    nome: "Separado, aguardando conferência",
    etapa: 3,
    descricao: "Separação realizada. Falta a conferência para liberar a montagem da carga.",
  },
  conferido: {
    nome: "Pronto para carga",
    etapa: 4,
    descricao: "Separação e conferência concluídas. Pedido disponível para montagem da carga.",
  },
  faturado: {
    nome: "Faturado, pronto para carga",
    etapa: 4,
    descricao: "Faturamento comercial registrado. Pedido aguardando inclusão na carga.",
  },
  nf_emitida: {
    nome: "Nota registrada, pronto para carga",
    etapa: 4,
    descricao: "Pedido com registro fiscal existente, aguardando inclusão na carga.",
  },
  em_carga: {
    nome: "Carga montada, aguardando saída",
    etapa: 5,
    descricao: "Pedido incluído na carga. Aguardando o despacho para iniciar a entrega.",
  },
  em_rota: {
    nome: "Em rota de entrega",
    etapa: 6,
    descricao: "Pedido despachado, seguindo para entrega ao cliente.",
  },
  parcial: {
    nome: "Entrega parcial",
    etapa: 6,
    atencao: true,
    descricao:
      "Há entrega parcial ou recusa. O saldo e as pendências precisam ser tratados antes da conclusão.",
  },
  nao_entregue: {
    nome: "Entrega não realizada",
    etapa: 6,
    atencao: true,
    descricao:
      "A entrega não foi concluída. Aguarde o tratamento da ocorrência pela equipe responsável.",
  },
  entregue: {
    nome: "Entregue",
    etapa: 7,
    descricao: "Recebimento formalizado pela equipe de entrega.",
  },
  recusado: {
    nome: "Pedido não aprovado",
    etapa: null,
    atencao: true,
    descricao: "O pedido não foi aprovado. Consulte o responsável comercial.",
  },
  cancelado: {
    nome: "Cancelado",
    etapa: null,
    atencao: true,
    descricao: "Pedido cancelado. O fluxo de entrega está encerrado.",
  },
  devolvido: {
    nome: "Devolvido",
    etapa: null,
    atencao: true,
    descricao: "Pedido devolvido. Consulte o tratamento da devolução com a equipe responsável.",
  },
};
export function situacaoPedido(status: unknown): SituacaoPedido {
  const codigo = String(status ?? "");
  const situacao = Object.hasOwn(SITUACOES, codigo) ? SITUACOES[codigo] : undefined;
  return (
    situacao ?? {
      nome: "Situação não identificada",
      etapa: null,
      atencao: true,
      descricao: "Consulte a equipe responsável para verificar a situação deste pedido.",
    }
  );
}
export function nomeStatusPedido(status: unknown) {
  return situacaoPedido(status).nome;
}
export function ordemStatusPedido(status: unknown) {
  return situacaoPedido(status).etapa ?? ETAPAS_PEDIDO.length;
}
