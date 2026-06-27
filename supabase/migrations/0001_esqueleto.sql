-- =====================================================================
-- Migration 0001 — Esqueleto (Fase 1)
-- Sistema de Gestão Ambiência (Ambiência + NETResíduos)
--
-- Schema mínimo da fundação. Cada módulo futuro adiciona suas tabelas em
-- migrations próprias, sem alterar estas.
-- Rode no SQL Editor do Supabase (ou via CLI) no projeto recém-criado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- empresas: as duas pessoas jurídicas do grupo (faturamento separado).
-- ---------------------------------------------------------------------
create table if not exists public.empresas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  cnpj       text,
  tipo       text not null check (tipo in ('ASS', 'NETR')),
  criado_em  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- perfil_usuario: estende o usuário do Supabase Auth (auth.users).
-- ---------------------------------------------------------------------
create table if not exists public.perfil_usuario (
  id         uuid primary key references auth.users (id) on delete cascade,
  nome       text,
  papel      text not null default 'admin',
  criado_em  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- integracao_config: credenciais/tokens das integrações (uma linha por
-- provedor). `credenciais` (jsonb) guarda tokens OAuth/keys. Acessada SÓ
-- pelo backend via service_role — o frontend nunca lê esta tabela.
-- ---------------------------------------------------------------------
create table if not exists public.integracao_config (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid references public.empresas (id) on delete set null,
  provedor      text not null unique,
  tipo_auth     text not null check (tipo_auth in ('oauth2', 'api_token', 'api_key')),
  credenciais   jsonb not null default '{}'::jsonb,
  status        text not null default 'desconectado',
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- sync_log: auditoria das sincronizações (automáticas e manuais).
-- ---------------------------------------------------------------------
create table if not exists public.sync_log (
  id            uuid primary key default gen_random_uuid(),
  provedor      text not null,
  empresa_id    uuid references public.empresas (id) on delete set null,
  status        text not null,
  mensagem      text,
  registros     integer not null default 0,
  iniciado_em   timestamptz not null default now(),
  finalizado_em timestamptz
);

-- =====================================================================
-- RLS — habilitado em todas as tabelas.
-- Fase 1: qualquer usuário autenticado lê/escreve empresas, perfil e
-- sync_log. integracao_config NÃO tem policy para usuários comuns: só o
-- service_role (backend) acessa, mantendo as credenciais protegidas.
-- =====================================================================
alter table public.empresas          enable row level security;
alter table public.perfil_usuario    enable row level security;
alter table public.integracao_config enable row level security;
alter table public.sync_log          enable row level security;

create policy "auth lê empresas"        on public.empresas       for select using (auth.role() = 'authenticated');
create policy "auth lê perfil"          on public.perfil_usuario for select using (auth.role() = 'authenticated');
create policy "auth gerencia o próprio" on public.perfil_usuario for all    using (auth.uid() = id) with check (auth.uid() = id);
create policy "auth lê sync_log"        on public.sync_log       for select using (auth.role() = 'authenticated');

-- =====================================================================
-- Seed — as duas empresas do grupo.
-- =====================================================================
insert into public.empresas (nome, tipo)
values ('Ambiência Soluções Sustentáveis', 'ASS'),
       ('NETResíduos', 'NETR')
on conflict do nothing;
