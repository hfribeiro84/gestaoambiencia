/**
 * Middleware de autenticação.
 *
 * Espera o cabeçalho `Authorization: Bearer <token>`, onde o token é o JWT
 * que o frontend recebeu do Supabase Auth ao fazer login. Valida o token
 * contra o Supabase e, se ok, anexa o usuário em `req.usuario`.
 */
import type { Request, Response, NextFunction } from 'express';
import { validarTokenUsuario } from '../config/supabase';

// Estende o tipo Request do Express para carregar o usuário autenticado.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: { id: string; email?: string };
    }
  }
}

export async function autenticar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const cabecalho = req.headers.authorization ?? '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';

  if (!token) {
    res.status(401).json({ erro: 'Token de autenticação ausente.' });
    return;
  }

  const usuario = await validarTokenUsuario(token);
  if (!usuario) {
    res.status(401).json({ erro: 'Token inválido ou expirado.' });
    return;
  }

  req.usuario = { id: usuario.id, email: usuario.email };
  next();
}
