/**
 * Wrapper de chamadas ao backend.
 *
 * Injeta automaticamente o token de acesso do Supabase no cabeçalho
 * Authorization, para que o middleware do backend valide a sessão.
 */
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string;

export async function api<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const resp = await fetch(`${API_URL}${caminho}`, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opcoes.headers ?? {}),
    },
  });

  if (!resp.ok) {
    const corpo = await resp.json().catch(() => ({ erro: `HTTP ${resp.status}` }));
    throw new Error(corpo.erro ?? `Erro ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

/** URL base do backend (usada para iniciar fluxos OAuth via navegação). */
export const urlBackend = API_URL;
