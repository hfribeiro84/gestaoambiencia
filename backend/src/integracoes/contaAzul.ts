/**
 * Conector Conta Azul (financeiro) — OAuth 2.0.
 *
 * Duas contas independentes: Ambiência (ASS) e NETResíduos (NETR).
 * Cada conta tem seu próprio app OAuth (client_id/secret) e seus tokens.
 *
 * Ordem de resolução das credenciais do app OAuth:
 * 1. Banco (`integracao_config`, campo `app_config`) — configurado pelo frontend
 * 2. Variáveis de ambiente — fallback para dev local
 *
 * Os tokens de acesso (access_token/refresh_token) são sempre salvos no banco.
 */
import { env } from '../config/env';
import { salvarCredencial, lerCredencial } from './persistencia';
import type { ResultadoTeste, Provedor } from '../tipos/integracao';

type ContaAzul = 'ass' | 'netr';

/** Configuração do app OAuth salva pelo frontend no banco. */
interface AppConfig {
  client_id: string;
  client_secret: string;
  authorize_url: string;
  token_url: string;
  api_base: string;
}

/** Configuração padrão (URLs conhecidas; client_id/secret vêm do banco ou env). */
const DEFAULTS = {
  authorize_url: 'https://auth.contaazul.com/login',
  token_url: 'https://auth.contaazul.com/oauth2/token',
  api_base: 'https://api-v2.contaazul.com',
};

function provedor(conta: ContaAzul): Provedor {
  return conta === 'ass' ? 'conta_azul_ass' : 'conta_azul_netr';
}

function redirectUri(conta: ContaAzul): string {
  return `${env.contaAzulRedirectBase}/api/integracoes/conta_azul_${conta}/callback`;
}

/** Lê a configuração do app OAuth do banco (com fallback para env). */
async function resolverAppConfig(conta: ContaAzul): Promise<AppConfig | null> {
  const cred = await lerCredencial(provedor(conta));
  const salvo = cred?.app_config as Partial<AppConfig> | undefined;

  const envCred = conta === 'ass' ? env.contaAzulAss : env.contaAzulNetr;
  const clientId = salvo?.client_id || envCred.clientId;
  const clientSecret = salvo?.client_secret || envCred.clientSecret;

  if (!clientId || !clientSecret) return null;

  return {
    client_id: clientId,
    client_secret: clientSecret,
    authorize_url: salvo?.authorize_url || DEFAULTS.authorize_url,
    token_url: salvo?.token_url || DEFAULTS.token_url,
    api_base: salvo?.api_base || DEFAULTS.api_base,
  };
}

/**
 * Salva a configuração do app OAuth no banco.
 * Preserva eventuais tokens já existentes — só atualiza o app_config.
 */
export async function configurar(conta: ContaAzul, config: Omit<AppConfig, 'api_base'> & { api_base?: string }): Promise<void> {
  const prov = provedor(conta);
  // Lê credenciais existentes pra não sobrescrever tokens OAuth já salvos.
  const atual = await lerCredencial(prov);
  await salvarCredencial(prov, 'oauth2', {
    ...(atual ?? { access_token: '' }),
    app_config: {
      client_id: config.client_id,
      client_secret: config.client_secret,
      authorize_url: config.authorize_url || DEFAULTS.authorize_url,
      token_url: config.token_url || DEFAULTS.token_url,
      api_base: config.api_base || DEFAULTS.api_base,
    },
  });
}

/** Monta a URL para o usuário autorizar o app (início do fluxo OAuth). */
export async function urlAutorizacao(conta: ContaAzul): Promise<string> {
  const cfg = await resolverAppConfig(conta);
  if (!cfg) throw new Error(`App OAuth do Conta Azul ${conta.toUpperCase()} não configurado.`);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.client_id,
    redirect_uri: redirectUri(conta),
    state: provedor(conta),
  });
  return `${cfg.authorize_url}?${params.toString()}`;
}

/** Troca o `code` recebido no callback por tokens e persiste no banco. */
export async function trocarCodigoPorToken(conta: ContaAzul, code: string): Promise<void> {
  const cfg = await resolverAppConfig(conta);
  if (!cfg) throw new Error(`App OAuth do Conta Azul ${conta.toUpperCase()} não configurado.`);

  const auth = Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64');
  const resp = await fetch(cfg.token_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(conta),
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Conta Azul (${conta}): HTTP ${resp.status} — ${body}`);
  }
  const tk = (await resp.json()) as { access_token: string; refresh_token?: string; expires_in?: number };

  // Preserva o app_config ao salvar os tokens.
  const atual = await lerCredencial(provedor(conta));
  await salvarCredencial(provedor(conta), 'oauth2', {
    ...(atual ?? {}),
    access_token: tk.access_token,
    refresh_token: tk.refresh_token,
    expira_em: tk.expires_in ? Date.now() + tk.expires_in * 1000 : undefined,
  });
}

/** Retorna um access token válido, renovando via refresh_token se necessário. */
export async function obterTokenValido(conta: ContaAzul): Promise<string> {
  const prov = provedor(conta);
  const cred = await lerCredencial(prov);

  if (!cred?.access_token) {
    throw new Error(`Conta Azul ${conta.toUpperCase()} não autorizada. Clique em "Conectar".`);
  }

  // Ainda dentro do prazo (margem de 5 min)?
  const expira = cred.expira_em as number | undefined;
  const expirado = expira ? Date.now() > expira - 5 * 60 * 1000 : false;

  if (!expirado) return cred.access_token as string;

  // Refresh
  if (!cred.refresh_token) {
    throw new Error(`Token expirado. Reconecte o Conta Azul ${conta.toUpperCase()}.`);
  }
  const cfg = await resolverAppConfig(conta);
  if (!cfg) throw new Error(`App OAuth do Conta Azul ${conta.toUpperCase()} não configurado.`);

  const auth = Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64');
  const resp = await fetch(cfg.token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${auth}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cred.refresh_token as string }),
  });
  if (!resp.ok) throw new Error(`Falha ao renovar token Conta Azul ${conta.toUpperCase()}: HTTP ${resp.status}`);

  const tk = (await resp.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  const atual = await lerCredencial(prov);
  await salvarCredencial(prov, 'oauth2', {
    ...(atual ?? {}),
    access_token: tk.access_token,
    refresh_token: tk.refresh_token ?? (cred.refresh_token as string),
    expira_em: tk.expires_in ? Date.now() + tk.expires_in * 1000 : undefined,
  });
  return tk.access_token;
}

/** Executa uma chamada autenticada à API do Conta Azul. */
export async function chamadaApi(
  conta: ContaAzul,
  endpoint: string,
  params?: Record<string, string>,
): Promise<Response> {
  const token = await obterTokenValido(conta);
  const cfg = await resolverAppConfig(conta);
  if (!cfg) throw new Error(`Conta Azul ${conta.toUpperCase()} sem configuração de API.`);
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return fetch(`${cfg.api_base}${endpoint}${qs}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

/** Testa a conexão: app configurado + token válido respondendo à API. */
export async function testarConexao(conta: ContaAzul): Promise<ResultadoTeste> {
  const prov = provedor(conta);
  const base: ResultadoTeste = {
    provedor: prov,
    tipoAuth: 'oauth2',
    status: 'nao_configurado',
    mensagem: `Conta Azul ${conta.toUpperCase()} — app OAuth não configurado.`,
  };

  const cfg = await resolverAppConfig(conta);
  if (!cfg) return base;

  try {
    const cred = await lerCredencial(prov);
    if (!cred?.access_token) {
      return { ...base, mensagem: `Conta Azul ${conta.toUpperCase()} — app configurado, clique em "Conectar" para autorizar.` };
    }

    const resp = await fetch(`${cfg.api_base}/v1/pessoa?pagina=1&tamanho_pagina=1`, {
      headers: { Authorization: `Bearer ${cred.access_token}` },
    });
    if (resp.status === 401) {
      return { ...base, status: 'erro', mensagem: 'Token expirado — clique em "Reconectar".' };
    }
    if (!resp.ok) {
      return { ...base, status: 'erro', mensagem: `HTTP ${resp.status} ao consultar o Conta Azul.` };
    }
    return { ...base, status: 'ok', mensagem: `Conectado ao Conta Azul ${conta.toUpperCase()}.` };
  } catch (e) {
    return { ...base, status: 'erro', mensagem: (e as Error).message };
  }
}
