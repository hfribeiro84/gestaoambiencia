/** Rota de saúde — usada para checar se a API está no ar (e pelo Railway). */
import { Router } from 'express';

export const rotasSaude = Router();

rotasSaude.get('/saude', (_req, res) => {
  res.json({ status: 'ok', servico: 'gestao-ambiencia-backend', horario: new Date().toISOString() });
});
