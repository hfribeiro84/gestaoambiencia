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
  authorize_url: 'https://auth.contaazul.com/oauth2/authorize',
  token_url: 'https://auth.contaazul.com/oauth2/token',
  api_base: 'https://api-v2.contaazul.com',
};

// Escopo fixo da API v2 do Conta Azul (AWS Cognito). Os escopos antigos
// (financas, sales, accounting...) são da API legada e o Cognito os rejeita
// com uma tela genérica de erro.
const SCOPE_CA = 'openid profile aws.cognito.signin.user.admin';

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
    // URLs e api_base são fixos da plataforma v2 — sempre do código, ignorando
    // valores legados salvos no banco (ex: o antigo endpoint /login).
    authorize_url: DEFAULTS.authorize_url,
    token_url: DEFAULTS.token_url,
    api_base: DEFAULTS.api_base,
  };
}

/**
 * Salva a configuração do app OAuth no banco.
 * Se o client_id mudou, apaga os tokens existentes e força reconexão —
 * manter tokens de um app diferente causaria refresh com credenciais erradas
 * e poderia cruzar dados entre as contas ASS e NETR.
 */
export async function configurar(conta: ContaAzul, config: Omit<AppConfig, 'api_base'> & { api_base?: string }): Promise<void> {
  const prov = provedor(conta);
  const atual = await lerCredencial(prov);
  const clientIdAtual = (atual?.app_config as Partial<AppConfig> | undefined)?.client_id;

  // Tokens ficam inválidos quando o app OAuth muda — zera para forçar novo fluxo.
  const tokensBase = clientIdAtual && clientIdAtual !== config.client_id
    ? { access_token: '' }
    : { access_token: atual?.access_token ?? '', refresh_token: atual?.refresh_token, expira_em: atual?.expira_em };

  await salvarCredencial(prov, 'oauth2', {
    ...tokensBase,
    app_config: {
      client_id: config.client_id,
      client_secret: config.client_secret,
      authorize_url: config.authorize_url || DEFAULTS.authorize_url,
      token_url: config.token_url || DEFAULTS.token_url,
      api_base: config.api_base || DEFAULTS.api_base,
    },
  });

  // Invalida cache de URL base — pode ter mudado com o novo app.
  apiBaseOk.delete(conta);
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
    scope: SCOPE_CA,
    // Força a tela de login a cada conexão. Sem isso, o Conta Azul reusa a sessão
    // ativa no navegador e conecta sempre a mesma empresa — fazendo o app da ASS
    // herdar o token da NETR (e vice-versa). Com prompt=login o usuário escolhe a
    // empresa correta em cada autorização.
    prompt: 'login',
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
  // Invalida cache de URL base — novo token pode pertencer a outro ambiente.
  apiBaseOk.delete(conta);
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

// Cache da URL base que funciona por sessão (evita tentativa dupla)
const apiBaseOk = new Map<ContaAzul, string>();
const CA_BASES_FALLBACK = [
  'https://api.contaazul.com',
  'https://api-v2.contaazul.com',
];

/** Executa uma chamada autenticada à API do Conta Azul.
 *  Se a URL configurada retornar 404, tenta bases alternativas automaticamente
 *  e cacheia qual funciona para as próximas chamadas da mesma sessão. */
export async function chamadaApi(
  conta: ContaAzul,
  endpoint: string,
  params?: Record<string, string>,
): Promise<Response> {
  const token = await obterTokenValido(conta);
  const cfg = await resolverAppConfig(conta);
  if (!cfg) throw new Error(`Conta Azul ${conta.toUpperCase()} sem configuração de API.`);

  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Se já descobrimos qual base funciona, usa direto
  const baseConhecida = apiBaseOk.get(conta);
  if (baseConhecida) {
    return fetch(`${baseConhecida}${endpoint}${qs}`, { headers });
  }

  // Tenta a URL configurada primeiro
  const resp = await fetch(`${cfg.api_base}${endpoint}${qs}`, { headers });

  // Erros de autenticação/permissão (401, 403) e sucesso (2xx, 404) não precisam de fallback
  if (resp.ok || resp.status === 401 || resp.status === 403 || resp.status === 404) {
    apiBaseOk.set(conta, cfg.api_base);
    return resp;
  }

  // Para outros erros (5xx, etc.) tenta bases alternativas — só aceita se der 2xx ou 404
  for (const base of CA_BASES_FALLBACK) {
    if (base === cfg.api_base) continue;
    const alt = await fetch(`${base}${endpoint}${qs}`, { headers });
    if (alt.ok || alt.status === 404) {
      console.log(`[CA ${conta}] URL base corrigida para: ${base}`);
      apiBaseOk.set(conta, base);
      return alt;
    }
  }

  // Nenhuma alternativa funcionou — devolve o erro original
  apiBaseOk.set(conta, cfg.api_base);
  return resp;
}

/**
 * Remove os tokens OAuth desta conta (mantém o app_config).
 * Use quando o token estiver corrompido ou pertencer à empresa errada.
 * Após desconectar, o usuário precisa passar pelo fluxo OAuth novamente.
 */
export async function desconectar(conta: ContaAzul): Promise<void> {
  const prov = provedor(conta);
  const atual = await lerCredencial(prov);
  await salvarCredencial(prov, 'oauth2', {
    ...(atual ?? {}),
    access_token: '',
    refresh_token: undefined,
    expira_em: undefined,
  });
  apiBaseOk.delete(conta);
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

  // Mostra o final do Client ID para o usuário comparar ASS x NETR — se forem
  // iguais, ambas as contas apontam para o mesmo app OAuth (causa da troca de dados).
  const idApp = cfg.client_id.length > 6 ? `…${cfg.client_id.slice(-6)}` : cfg.client_id;
  base.detalhe = `App OAuth (Client ID): ${idApp}`;

  try {
    const cred = await lerCredencial(prov);
    if (!cred?.access_token) {
      return { ...base, status: 'nao_configurado', mensagem: `Conta Azul ${conta.toUpperCase()} — app configurado, clique em "Conectar" para autorizar.` };
    }

    let token: string;
    try {
      token = await obterTokenValido(conta);
    } catch (e) {
      return { ...base, status: 'erro', mensagem: (e as Error).message };
    }

    const resp = await fetch(`${cfg.api_base}/v1/pessoa?pagina=1&tamanho_pagina=1`, {
      headers: { Authorization: `Bearer ${token}` },
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
