-- Migration 0004 — Persiste o último resultado da conferência por mês
-- Rode no SQL Editor do Supabase.

alter table public.nf_planilha_salva
  add column if not exists ultimo_resultado jsonb,
  add column if not exists resultado_em     timestamptz;
