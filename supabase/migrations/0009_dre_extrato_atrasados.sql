-- Migration 0009: snapshot de contas em atraso no extrato
-- Guarda, junto do extrato salvo, um resumo das contas vencidas e em aberto
-- (a receber e a pagar) — informativo, não entra no saldo de caixa.

ALTER TABLE dre_extrato ADD COLUMN IF NOT EXISTS atrasados jsonb;
