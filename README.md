# Sistema de Gestão Ambiência

Plataforma web própria para centralizar a gestão administrativa, financeira, comercial e
operacional da **Ambiência Soluções Sustentáveis (ASS)** e da **NETResíduos (NETR)** —
substituindo planilhas e ferramentas desconectadas, com visão consolidada do grupo e
visão individual por empresa, além de análises por IA (Claude).

> Este repositório está na **Fase 1 — Esqueleto**: estrutura base, autenticação, banco
> configurado, camada de conexão com as APIs e hospedagem. Os módulos de negócio
> (Financeiro, Resultado por Projeto, Contratos, Unidades NETR, RH, Comercial, Dashboard)
> são construídos um a um sobre esta fundação.

## Stack

| Camada    | Tecnologia                          | Hospedagem |
| --------- | ----------------------------------- | ---------- |
| Frontend  | React + Vite + TypeScript           | Vercel     |
| Backend   | Node + Express + TypeScript         | Railway    |
| Banco/Auth| Supabase (PostgreSQL + Supabase Auth) | Supabase |
| IA        | API do Claude (Anthropic)           | —          |

## Estrutura

```
backend/    API Node/Express + camada de integrações
frontend/   SPA React (Vite)
supabase/   Migrations SQL do banco
CLAUDE.md   Documentação viva do projeto (estrutura, decisões, tabelas, endpoints)
```

## Como rodar local

Veja o passo a passo detalhado em [CLAUDE.md](./CLAUDE.md).

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend (outro terminal)
cd frontend && npm install && npm run dev
```

Cada app tem um `.env.example` — copie para `.env` e preencha as credenciais.
