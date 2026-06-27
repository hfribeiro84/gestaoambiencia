/**
 * Cliente Supabase do frontend (autenticação).
 *
 * Usa a anon key (pública). O login email/senha é feito direto contra o
 * Supabase Auth; o token resultante é enviado ao backend nas chamadas de API.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anonKey);
