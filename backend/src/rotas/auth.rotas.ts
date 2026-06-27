/**
 * Rotas de autenticação.
 *
 * O login em si é feito pelo frontend direto no Supabase Auth (email/senha).
 * Aqui só expomos um endpoint protegido para o frontend confirmar a sessão e
 * obter os dados do usuário autenticado.
 */
import { Router } from 'express';
import { autenticar } from '../middleware/auth';

export const rotasAuth = Router();

// GET /api/auth/eu — devolve o usuário autenticado (valida o token).
rotasAuth.get('/auth/eu', autenticar, (req, res) => {
  res.json({ usuario: req.usuario });
});
