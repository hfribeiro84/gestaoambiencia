-- =====================================================================
-- Migration 0002 — Módulo Financeiro: planilha NF salva por mês
--
-- Guarda os itens parseados da planilha "NF a emitir" por empresa/mês/ano.
-- A planilha é quase fixa (preparada uma vez); o que muda é o Conta Azul.
-- Rode no SQL Editor do Supabase.
-- =====================================================================

create table if not exists public.nf_planilha_salva (
  id            uuid primary key default gen_random_uuid(),
  empresa       text not null check (empresa in ('ass', 'netr')),
  mes           integer not null check (mes between 1 and 12),
  ano           integer not null check (ano between 2020 and 2100),
  itens         jsonb not null default '[]',
  atualizado_em timestamptz not null default now(),
  unique (empresa, mes, ano)
);

alter table public.nf_planilha_salva enable row level security;

create policy "autenticado lê e grava nf_planilha_salva"
  on public.nf_planilha_salva
  for all
  to authenticated
  using (true)
  with check (true);
