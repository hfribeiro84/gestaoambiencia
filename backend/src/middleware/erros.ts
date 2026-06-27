/**
 * Tratamento centralizado de erros.
 *
 * Captura qualquer exceção não tratada nas rotas e devolve uma resposta JSON
 * padronizada, evitando vazar stack trace ao cliente.
 */
import type { Request, Response, NextFunction } from 'express';

export function tratadorDeErros(
  err: unknown,
  _req: Request,
  res: Response,
  // O 4º parâmetro é obrigatório para o Express reconhecer como error handler.
  _next: NextFunction,
): void {
  const mensagem = err instanceof Error ? err.message : 'Erro interno do servidor.';
  console.error('[erro]', err);
  res.status(500).json({ erro: mensagem });
}
