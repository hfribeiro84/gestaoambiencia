/**
 * Carrega e valida as variáveis de ambiente.
 *
 * Boa prática obrigatória do projeto: TODA credencial/chave vem do `.env`,
 * nunca fica no código. Aqui centralizamos a leitura e damos valores padrão
 * seguros para o ambiente local.
 */
import dotenv from 'dotenv';

dotenv.config();

/** Lê uma variável; se ausente, usa o padrão (ou string vazia). */
function ler(nome: string, padrao = ''): string {
  return process.env[nome] ?? padrao;
}

export const env = {
  // Servidor
  porta: Number(ler('PORT', '3333')),
  frontendUrl: ler('FRONTEND_URL', 'http://localhost:5173'),

  // Supabase
  supabaseUrl: ler('SUPABASE_URL'),
  supabaseAnonKey: ler('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: ler('SUPABASE_SERVICE_ROLE_KEY'),

  // Claude (Anthropic)
  anthropicApiKey: ler('ANTHROPIC_API_KEY'),
  claudeModeloRapido: ler('CLAUDE_MODELO_RAPIDO', 'claude-haiku-4-5-20251001'),
  claudeModeloAvancado: ler('CLAUDE_MODELO_AVANCADO', 'claude-sonnet-4-6'),

  // Pipedrive (URL base fixa: https://api.pipedrive.com/v1)
  pipedriveApiToken: ler('PIPEDRIVE_API_TOKEN'),

  // Clockify
  clockifyApiKey: ler('CLOCKIFY_API_KEY'),
  clockifyWorkspaceId: ler('CLOCKIFY_WORKSPACE_ID'),

  // Conta Azul — duas contas (ASS e NETR)
  contaAzulAss: {
    clientId: ler('CONTA_AZUL_ASS_CLIENT_ID'),
    clientSecret: ler('CONTA_AZUL_ASS_CLIENT_SECRET'),
  },
  contaAzulNetr: {
    clientId: ler('CONTA_AZUL_NETR_CLIENT_ID'),
    clientSecret: ler('CONTA_AZUL_NETR_CLIENT_SECRET'),
  },
  contaAzulRedirectBase: ler('CONTA_AZUL_REDIRECT_BASE', 'http://localhost:3333'),

  // Google Drive
  googleClientId: ler('GOOGLE_CLIENT_ID'),
  googleClientSecret: ler('GOOGLE_CLIENT_SECRET'),
  googleRedirectBase: ler('GOOGLE_REDIRECT_BASE', 'http://localhost:3333'),
};

/**
 * Indica se uma credencial essencial está configurada. Usado pelos conectores
 * para responder "não configurado" em vez de quebrar quando a chave ainda não
 * foi preenchida (cenário normal durante a Fase 1).
 */
export function temCredencial(...valores: string[]): boolean {
  return valores.every((v) => v.trim().length > 0);
}
