/**
 * Conector Google Drive (arquivos de contratos) — OAuth 2.0.
 *
 * Na Fase 1: fluxo OAuth + teste de conexão. O módulo Contratos vai LISTAR os
 * arquivos das pastas (ASS e NETR) e dar acesso por link; a leitura do
 * conteúdo dos documentos é evolução futura.
 *
 * Escopo somente-leitura (`drive.readonly`).
 */
import { env } from '../config/env';
import { salvarCredencial, lerCredencial } from './persistencia';
import type { ResultadoTeste } from '../tipos/integracao';

const AUTORIZA_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT_URI = `${env.googleRedirectBase}/api/integracoes/google_drive/callback`;

/** Monta a URL de consentimento do Google (início do fluxo OAuth). */
export function urlAutorizacao(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.googleClientId,
    redirect_uri: REDIRECT_URI,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    access_type: 'offline', // pede refresh_token
    prompt: 'consent',
    state: 'google_drive',
  });
  return `${AUTORIZA_URL}?${params.toString()}`;
}

/** Troca o `code` por tokens e persiste no banco. */
export async function trocarCodigoPorToken(code: string): Promise<void> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!resp.ok) {
    throw new Error(`Google Drive: HTTP ${resp.status} ao trocar code por token.`);
  }
  const tk = (await resp.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  await salvarCredencial('google_drive', 'oauth2', {
    access_token: tk.access_token,
    refresh_token: tk.refresh_token,
    expira_em: tk.expires_in ? Date.now() + tk.expires_in * 1000 : undefined,
  });
}

/** Testa a conexão consultando o perfil do Drive (about). */
export async function testarConexao(): Promise<ResultadoTeste> {
  const base: ResultadoTeste = {
    provedor: 'google_drive',
    tipoAuth: 'oauth2',
    status: 'nao_configurado',
    mensagem: 'Google Drive ainda não autorizado.',
  };

  if (!env.googleClientId || !env.googleClientSecret) {
    return { ...base, mensagem: 'Client id/secret do Google ainda não configurados.' };
  }

  try {
    const cred = await lerCredencial('google_drive');
    if (!cred?.access_token) return base;

    const resp = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
      { headers: { Authorization: `Bearer ${cred.access_token}` } },
    );
    if (resp.status === 401) {
      return { ...base, status: 'erro', mensagem: 'Token expirado — reconecte o Google Drive.' };
    }
    if (!resp.ok) {
      return { ...base, status: 'erro', mensagem: `HTTP ${resp.status} ao consultar o Google Drive.` };
    }
    const json = (await resp.json()) as { user?: { emailAddress?: string } };
    return {
      ...base,
      status: 'ok',
      mensagem: 'Conectado ao Google Drive.',
      detalhe: json.user?.emailAddress,
    };
  } catch (e) {
    return { ...base, status: 'erro', mensagem: (e as Error).message };
  }
}
