/** Mensagens não revelam se um e-mail pertence a outra pessoa. */
export function estadoRecuperacaoSenha(anterior: boolean, evento: string) {
  if (evento === "PASSWORD_RECOVERY") return true;
  if (evento === "SIGNED_OUT") return false;
  return anterior;
}

export function mensagemLogin(code?: string) {
  if (code === "email_not_confirmed")
    return "Confirme seu e-mail pelo link recebido antes de entrar. A aprovação do cadastro é uma etapa separada.";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit")
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  return "E-mail ou senha incorretos. Use a senha definida no primeiro cadastro; a aprovação não muda sua senha. Se não lembrar, use Esqueci minha senha.";
}

export function validarNovaSenha(nova: string, confirmacao: string, atual?: string) {
  if (nova.length < 8) return "A nova senha deve ter pelo menos 8 caracteres.";
  if (nova !== confirmacao) return "As novas senhas não conferem.";
  if (atual !== undefined && nova === atual) return "Escolha uma senha diferente da atual.";
  return null;
}

export function mensagemTrocaSenha(code?: string) {
  if (code === "same_password") return "Escolha uma senha diferente da atual.";
  if (code === "weak_password")
    return "Escolha uma senha mais forte, conforme as regras de segurança.";
  if (code === "over_request_rate_limit")
    return "Aguarde alguns minutos antes de tentar novamente.";
  return "Não foi possível alterar a senha. Confira a senha atual e os requisitos de segurança da sua conta. Se o problema continuar, procure o administrador.";
}
