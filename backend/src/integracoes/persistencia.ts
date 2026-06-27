/**
 * Persistência das credenciais de integração na tabela `integracao_config`.
 *
 * Tokens OAuth (Conta Azul ASS/NETR, Google Drive) são guardados no banco via
 * service_role, separados do código. O frontend nunca acessa esta tabela.
 */
import { supabaseAdmin } from '../config/supabase';
import type { Provedor, TipoAuth } from '../tipos/integracao';

export interface CredenciaisOAuth {
  access_token: string;
  refresh_token?: string;
  /** Epoch (ms) de expiração do access_token, quando informado. */
  expira_em?: number;
  [extra: string]: unknown;
}

/** Salva (upsert) as credenciais de um provedor. */
export async function salvarCredencial(
  provedor: Provedor,
  tipoAuth: TipoAuth,
  credenciais: CredenciaisOAuth,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('integracao_config')
    .upsert(
      {
        provedor,
        tipo_auth: tipoAuth,
        credenciais,
        status: 'conectado',
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'provedor' },
    );
  if (error) throw new Error(`Falha ao salvar credencial de ${provedor}: ${error.message}`);
}

/** Lê as credenciais salvas de um provedor (ou null se não houver). */
export async function lerCredencial(provedor: Provedor): Promise<CredenciaisOAuth | null> {
  const { data, error } = await supabaseAdmin
    .from('integracao_config')
    .select('credenciais')
    .eq('provedor', provedor)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler credencial de ${provedor}: ${error.message}`);
  return (data?.credenciais as CredenciaisOAuth) ?? null;
}
