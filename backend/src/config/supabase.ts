/**
 * Clientes Supabase do backend.
 *
 * - `supabaseAdmin`: usa a service_role key. Tem acesso total ao banco e
 *   IGNORA o RLS. Use só no backend, para ler/gravar credenciais de
 *   integração, logs de sync, etc. NUNCA exponha essa chave ao frontend.
 * - `validarTokenUsuario`: valida o JWT enviado pelo frontend (login do
 *   Supabase Auth) e devolve o usuário autenticado.
 */
import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/** Cliente administrativo (service_role) — acesso total, ignora RLS. */
export const supabaseAdmin = createClient(
  env.supabaseUrl,
  env.supabaseServiceRoleKey,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

/**
 * Valida um token de acesso (JWT) emitido pelo Supabase Auth.
 * Retorna o usuário se válido, ou `null` caso contrário.
 */
export async function validarTokenUsuario(token: string) {
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}
