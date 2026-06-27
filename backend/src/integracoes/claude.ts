/**
 * Conector Claude (Anthropic).
 *
 * Camada de IA do sistema: Haiku para análises rápidas/alertas, Sonnet para
 * relatórios executivos. Na Fase 1 expomos o cliente e um teste de conexão;
 * os prompts de cada análise entram junto com os respectivos módulos.
 */
import Anthropic from '@anthropic-ai/sdk';
import { env, temCredencial } from '../config/env';
import type { ResultadoTeste } from '../tipos/integracao';

/** Cliente Anthropic compartilhado (ou null se a chave não estiver configurada). */
export const anthropic = temCredencial(env.anthropicApiKey)
  ? new Anthropic({ apiKey: env.anthropicApiKey })
  : null;

/** Faz uma chamada mínima ao modelo rápido para validar a API key. */
export async function testarConexao(): Promise<ResultadoTeste> {
  const base: ResultadoTeste = {
    provedor: 'claude',
    tipoAuth: 'api_key',
    status: 'nao_configurado',
    mensagem: 'API key da Anthropic ainda não configurada.',
  };

  if (!anthropic) return base;

  try {
    const resp = await anthropic.messages.create({
      model: env.claudeModeloRapido,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'responda apenas: ok' }],
    });
    const texto = resp.content.find((c) => c.type === 'text');
    return {
      ...base,
      status: 'ok',
      mensagem: 'Conectado à API do Claude.',
      detalhe: texto && texto.type === 'text' ? texto.text.trim() : env.claudeModeloRapido,
    };
  } catch (e) {
    return { ...base, status: 'erro', mensagem: (e as Error).message };
  }
}
