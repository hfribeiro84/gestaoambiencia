-- Migration 0011: link da planilha (Google Sheets publicado como CSV)
-- Quando preenchido, "Atualizar" busca o CSV direto desse link antes de
-- comparar com o Conta Azul — dispensa baixar/subir arquivo manualmente.

ALTER TABLE public.nf_planilha_salva ADD COLUMN IF NOT EXISTS fonte_url text;
