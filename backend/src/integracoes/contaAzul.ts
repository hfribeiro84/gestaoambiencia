/**
 * Conector Conta Azul (financeiro) — OAuth 2.0.
 *
 * São DUAS contas independentes: Ambiência (ASS) e NETResíduos (NETR), cada
 * uma com seu próprio app OAuth (client id/secret) e seus próprios tokens.
 * Distinguimos pelo provedor: `conta_azul_ass` e `conta_azul_netr`.
 *
 * OBS.: os endpoints OAuth do Conta Azul devem ser confirmados no momento do
 * registro do app (painel de desenvolvedor). Os valores abaixo seguem o fluxo
 * padrão Authorization Code; ajuste as URLs se o registro indicar outras.
 */
import { env } from '../config/env';
import { salvarCredencial, lerCredencial } from './persistencia';
import type { ResultadoTeste, Provedor } from '../tipos/integracao';

type ContaAzul = 'ass' | 'netr';

const AUTORIZA_URL = 'https://auth.contaazul.com/oauth2/authorize';
const TOKEN_URL = 'https://auth.contaazul.com/oauth2/token';
const API_BASE = 'https://api-v2.contaazul.com';

function config(conta: ContaAzul) {
  const cred = conta === 'ass' ? env.contaAzulAss : env.contaAzulNetr;
  const provedor: Provedor = conta === 'ass' ? 'conta_azul_ass' : 'conta_azul_netr';
  const redirectUri = `${env.contaAzulRedirectBase}/api/integracoes/conta_azul_${conta}/callback`;
  return { ...cred, provedor, redirectUri };
}

/** Monta a URL para o usuário autorizar o app (início do fluxo OAuth). */
export function urlAutorizacao(conta: ContaAzul): string {
  const c = config(conta);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    scope: 'openid profile',
    state: c.provedor,
  });
  return `${AUTORIZA_URL}?${params.toString()}`;
}

/** Troca o `code` recebido no callback por tokens e persiste no banco. */
export async function trocarCodigoPorToken(conta: ContaAzul, code: string): Promise<void> {
  const c = config(conta);
  const auth = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: c.redirectUri,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Conta Azul (${conta}): HTTP ${resp.status} ao trocar code por token.`);
  }
  const tk = (await resp.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  await salvarCredencial(c.provedor, 'oauth2', {
    access_token: tk.access_token,
    refresh_token: tk.refresh_token,
    expira_em: tk.expires_in ? Date.now() + tk.expires_in * 1000 : undefined,
  });
}

/** Testa a conexão: existe token salvo e ele ainda responde a API. */
export async function testarConexao(conta: ContaAzul): Promise<ResultadoTeste> {
  const c = config(conta);
  const base: ResultadoTeste = {
    provedor: c.provedor,
    tipoAuth: 'oauth2',
    status: 'nao_configurado',
    mensagem: `Conta Azul ${conta.toUpperCase()} ainda não autorizada.`,
  };

  if (!c.clientId || !c.clientSecret) {
    return { ...base, mensagem: `Client id/secret do Conta Azul ${conta.toUpperCase()} não configurados.` };
  }

  try {
    const cred = await lerCredencial(c.provedor);
    if (!cred?.access_token) return base;

    const resp = await fetch(`${API_BASE}/v1/pessoa?pagina=1&tamanho_pagina=1`, {
      headers: { Authorization: `Bearer ${cred.access_token}` },
    });
    if (resp.status === 401) {
      return { ...base, status: 'erro', mensagem: 'Token expirado — reconecte o Conta Azul.' };
    }
    if (!resp.ok) {
      return { ...base, status: 'erro', mensagem: `HTTP ${resp.status} ao consultar o Conta Azul.` };
    }
    return { ...base, status: 'ok', mensagem: `Conectado ao Conta Azul ${conta.toUpperCase()}.` };
  } catch (e) {
    return { ...base, status: 'erro', mensagem: (e as Error).message };
  }
}
