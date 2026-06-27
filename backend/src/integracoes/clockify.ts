/**
 * Conector Clockify (registro de horas).
 *
 * Autenticação por API key (cabeçalho X-Api-Key). Na Fase 1 só o teste de
 * conexão; horas e custos por projeto entram nos módulos Resultado por
 * Projeto e RH.
 */
import { env, temCredencial } from '../config/env';
import type { ResultadoTeste } from '../tipos/integracao';

/** Testa a credencial chamando o endpoint /user do Clockify. */
export async function testarConexao(): Promise<ResultadoTeste> {
  const base: ResultadoTeste = {
    provedor: 'clockify',
    tipoAuth: 'api_key',
    status: 'nao_configurado',
    mensagem: 'API key do Clockify ainda não configurada.',
  };

  if (!temCredencial(env.clockifyApiKey)) {
    return base;
  }

  try {
    const resp = await fetch('https://api.clockify.me/api/v1/user', {
      headers: { 'X-Api-Key': env.clockifyApiKey },
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
