/**
 * Conector Pipedrive (CRM e contratos) — API token.
 *
 * URL base fixa: https://api.pipedrive.com/v1/
 * (com autenticação por API token não é necessário o domínio da empresa)
 *
 * Ordem de resolução da credencial:
 * 1. Banco (`integracao_config`) — configurado pelo frontend
 * 2. Variável de ambiente `PIPEDRIVE_API_TOKEN` — fallback para dev local
 */
import { env, temCredencial } from '../config/env';
import { lerCredencial, salvarCredencial } from './persistencia';
import type { ResultadoTeste } from '../tipos/integracao';

const API_BASE = 'https://api.pipedrive.com/v1';

async function resolverToken(): Promise<string | null> {
  const cred = await lerCredencial('pipedrive');
  const token = (cred?.api_token as string) || env.pipedriveApiToken;
  return temCredencial(token) ? token : null;
}

/** Salva o token no banco (chamado pelo endpoint /configurar). */
export async function configurar(apiToken: string): Promise<void> {
  await salvarCredencial('pipedrive', 'api_token', { access_token: '', api_token: apiToken });
}

/** Testa a credencial chamando GET /v1/users/me do Pipedrive. */
export async function testarConexao(): Promise<ResultadoTeste> {
  const base: ResultadoTeste = {
    provedor: 'pipedrive',
    tipoAuth: 'api_token',
    status: 'nao_configurado',
    mensagem: 'Token do Pipedrive ainda não configurado.',
  };

  const token = await resolverToken();
  if (!token) return base;

  try {
    const resp = await fetch(`${API_BASE}/users/me?api_token=${token}`);
    if (!resp.ok) {
      return { ...base, status: 'erro', mensagem: `HTTP ${resp.status} ao consultar o Pipedrive.` };
    }
    const json = (await resp.json()) as { data?: { name?: string; company_name?: string } };
    return {
      ...base,
      status: 'ok',
      mensagem: 'Conectado ao Pipedrive.',
      detalhe: json.data?.company_name ?? json.data?.name,
    };
  } catch (e) {
    return { ...base, status: 'erro', mensagem: (e as Error).message };
  }
}
