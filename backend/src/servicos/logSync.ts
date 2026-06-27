/**
 * Auditoria de sincronizações na tabela `sync_log`.
 *
 * Toda execução de sync (automática ou manual) registra início, fim, status e
 * quantidade de registros, para rastreabilidade.
 */
import { supabaseAdmin } from '../config/supabase';
import type { Provedor } from '../tipos/integracao';

/** Abre um registro de sync e devolve o id para fechá-lo depois. */
export async function iniciarLog(provedor: Provedor | 'todos'): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('sync_log')
    .insert({ provedor, status: 'em_andamento', iniciado_em: new Date().toISOString() })
    .select('id')
    .single();
  if (error) {
    console.error('[sync_log] falha ao iniciar:', error.message);
    return null;
  }
  return data.id as string;
}

/** Fecha um registro de sync com o resultado final. */
export async function finalizarLog(
  id: string | null,
  status: 'sucesso' | 'erro',
  mensagem: string,
  registros = 0,
): Promise<void> {
  if (!id) return;
  const { error } = await supabaseAdmin
    .from('sync_log')
    .update({ status, mensagem, registros, finalizado_em: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error('[sync_log] falha ao finalizar:', error.message);
}
