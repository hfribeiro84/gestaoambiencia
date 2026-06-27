/**
 * Conector Pipedrive (CRM e contratos).
 *
 * Autenticação por API token. Na Fase 1 implementamos apenas o teste de
 * conexão; a leitura de funis/negócios entra nos módulos Comercial e Contratos.
 */
import { env, temCredencial } from '../config/env';
import type { ResultadoTeste } from '../tipos/integracao';

/** Testa a credencial chamando o endpoint /users/me do Pipedrive. */
export async function testarConexao(): Promise<ResultadoTeste> {
  const base: ResultadoTeste = {
    provedor: 'pipedrive',
    tipoAuth: 'api_token',
    status: 'nao_configurado',
    mensagem: 'Token do Pipedrive ainda não configurado.',
  };

  if (!temCredencial(env.pipedriveApiToken, env.pipedriveDominio)) {
    return base;
  }

  try {
    const url = `${env.pipedriveDominio}/api/v1/users/me?api_token=${env.pipedriveApiToken}`;
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
