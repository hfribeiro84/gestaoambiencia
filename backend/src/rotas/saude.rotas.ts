/** Rota de saúde — usada para checar se a API está no ar (e pelo Railway). */
import { Router } from 'express';

export const rotasSaude = Router();

rotasSaude.get('/saude', (_req, res) => {
  res.json({ status: 'ok', servico: 'gestao-ambiencia-backend', horario: new Date().toISOString() });
});

/**
 * Diagnóstico: mostra o IP público e o país de SAÍDA do backend — exatamente o
 * que o Conta Azul (e outras APIs) enxergam. Serve para confirmar se o servidor
 * está numa região/país bloqueado. Público, sem auth (não expõe dados sensíveis).
 */
rotasSaude.get('/saude/regiao', async (_req, res) => {
  // Tenta dois serviços de geolocalização de IP (sem chave), com fallback.
  const fontes = ['https://ipapi.co/json/', 'http://ip-api.com/json/'];
  for (const url of fontes) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const d = (await r.json()) as Record<string, unknown>;
      res.json({
        ip: d.ip ?? d.query ?? null,
        pais: d.country_name ?? d.country ?? null,
        codigoPais: d.country_code ?? d.countryCode ?? null,
        regiao: d.region ?? d.regionName ?? null,
        cidade: d.city ?? null,
        fonte: url,
      });
      return;
    } catch {
      // tenta a próxima fonte
    }
  }
  res.status(502).json({ erro: 'Não foi possível determinar o IP/país de saída.' });
});
