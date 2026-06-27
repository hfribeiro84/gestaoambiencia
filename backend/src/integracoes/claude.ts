/**
 * Conector Claude (Anthropic) — API key.
 *
 * Ordem de resolução da credencial:
 * 1. Banco (`integracao_config`) — configurado pelo frontend
 * 2. Variável de ambiente `ANTHROPIC_API_KEY` — fallback para dev local
 */
import Anthropic from '@anthropic-ai/sdk';
import { env, temCredencial } from '../config/env';
import { lerCredencial, salvarCredencial } from './persistencia';
import type { ResultadoTeste } from '../tipos/integracao';

async function resolverKey(): Promise<string | null> {
  const cred = await lerCredencial('claude');
  const key = (cred?.api_key as string) || env.anthropicApiKey;
  return temCredencial(key) ? key : null;
}

/** Salva a API key no banco (chamado pelo endpoint /configurar). */
export async function configurar(apiKey: string): Promise<void> {
  await salvarCredencial('claude', 'api_key', { access_token: '', api_key: apiKey });
}

/** Faz uma chamada mínima ao modelo rápido para validar a API key. */
export async function testarConexao(): Promise<ResultadoTeste> {
  const base: ResultadoTeste = {
    provedor: 'claude',
    tipoAuth: 'api_key',
    status: 'nao_configurado',
    mensagem: 'API key da Anthropic ainda não configurada.',
  };

  const key = await resolverKey();
  if (!key) return base;

  try {
    const client = new Anthropic({ apiKey: key });
    const resp = await client.messages.create({
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

/** Cria um cliente Anthropic com a key resolvida (banco ou env). */
export async function criarCliente(): Promise<Anthropic | null> {
  const key = await resolverKey();
  return key ? new Anthropic({ apiKey: key }) : null;
}
