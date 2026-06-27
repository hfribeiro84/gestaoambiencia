/**
 * Conector Clockify (registro de horas) — API key.
 *
 * Ordem de resolução da credencial:
 * 1. Banco (`integracao_config`) — configurado pelo frontend
 * 2. Variável de ambiente `CLOCKIFY_API_KEY` — fallback para dev local
 */
import { env, temCredencial } from '../config/env';
import { lerCredencial, salvarCredencial } from './persistencia';
import type { ResultadoTeste } from '../tipos/integracao';

async function resolverKey(): Promise<string | null> {
  const cred = await lerCredencial('clockify');
  const key = (cred?.api_key as string) || env.clockifyApiKey;
  return temCredencial(key) ? key : null;
}

/** Salva a API key no banco (chamado pelo endpoint /configurar). */
export async function configurar(apiKey: string): Promise<void> {
  await salvarCredencial('clockify', 'api_key', { access_token: '', api_key: apiKey });
}

/** Testa a credencial chamando o endpoint /user do Clockify. */
export async function testarConexao(): Promise<ResultadoTeste> {
  const base: ResultadoTeste = {
    provedor: 'clockify',
    tipoAuth: 'api_key',
    status: 'nao_configurado',
    mensagem: 'API key do Clockify ainda não configurada.',
  };

  const key = await resolverKey();
  if (!key) return base;

  try {
    const resp = await fetch('https://api.clockify.me/api/v1/user', {
      headers: { 'X-Api-Key': key },
    });
    if (!resp.ok) {
      return { ...base, status: 'erro', mensagem: `HTTP ${resp.status} ao consultar o Clockify.` };
    }
    const json = (await resp.json()) as { name?: string; email?: string };
    return {
      ...base,
      status: 'ok',
      mensagem: 'Conectado ao Clockify.',
      detalhe: json.name ?? json.email,
    };
  } catch (e) {
    return { ...base, status: 'erro', mensagem: (e as Error).message };
  }
}
