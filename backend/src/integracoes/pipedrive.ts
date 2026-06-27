/**
 * Conector Pipedrive (CRM e contratos) — API token.
 *
 * Ordem de resolução da credencial:
 * 1. Banco (`integracao_config`) — configurado pelo frontend
 * 2. Variável de ambiente `PIPEDRIVE_API_TOKEN` — fallback para dev local
 */
import { env, temCredencial } from '../config/env';
import { lerCredencial, salvarCredencial } from './persistencia';
import type { ResultadoTeste } from '../tipos/integracao';

/** Lê o token do banco; se não houver, usa o env. */
async function resolverToken(): Promise<{ token: string; dominio: string } | null> {
  const cred = await lerCredencial('pipedrive');
  const token = (cred?.api_token as string) || env.pipedriveApiToken;
  const dominio = (cred?.dominio as string) || env.pipedriveDominio;
  if (!temCredencial(token, dominio)) return null;
  return { token, dominio };
}

/** Salva token e domínio no banco (chamado pelo endpoint /configurar). */
export async function configurar(apiToken: string, dominio: string): Promise<void> {
  await salvarCredencial('pipedrive', 'api_token', { access_token: '', api_token: apiToken, dominio });
}

/** Testa a credencial chamando o endpoint /users/me do Pipedrive. */
export async function testarConexao(): Promise<ResultadoTeste> {
  const base: ResultadoTeste = {
    provedor: 'pipedrive',
    tipoAuth: 'api_token',
    status: 'nao_configurado',
    mensagem: 'Token do Pipedrive ainda não configurado.',
  };

  const creds = await resolverToken();
  if (!creds) return base;

  try {
    const url = `${creds.dominio}/api/v1/users/me?api_token=${creds.token}`;
    const resp = await fetch(url);
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
