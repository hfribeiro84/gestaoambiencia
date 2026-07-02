-- Migration 0010: marca item do extrato como previsto (competência) x realizado (caixa)
-- Modelo híbrido: até ontem = caixa (baixas reais); de hoje em diante = previsto
-- (parcelas em aberto pela data de vencimento).

ALTER TABLE dre_extrato_item ADD COLUMN IF NOT EXISTS previsto boolean NOT NULL DEFAULT false;
