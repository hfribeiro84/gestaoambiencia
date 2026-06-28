-- Migration 0003 — Alíquota de ISS por empresa/mês
-- Adiciona coluna nullable em nf_planilha_salva.
-- Rode no SQL Editor do Supabase.

alter table public.nf_planilha_salva
  add column if not exists aliquota_iss numeric(5,2);
