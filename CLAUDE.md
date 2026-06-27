# CLAUDE.md — Sistema de Gestão Ambiência

Documentação viva do projeto. **Atualizar a cada sessão** (boa prática obrigatória):
estrutura de pastas, decisões de arquitetura, tabelas do banco e endpoints criados.

## O que é

Plataforma web própria para centralizar a gestão administrativa, financeira, comercial e
operacional da **Ambiência Soluções Sustentáveis (ASS)** e da **NETResíduos (NETR)**.
Visão consolidada do grupo + visão individual por empresa, com análises de IA (Claude).
Desenvolvimento **modular e incremental** — um módulo por vez sobre a fundação.

## Status

- **Fase 1 — Esqueleto: em construção.** Estrutura base, autenticação, banco, camada de
  conexão com as APIs e configs de deploy prontos. Falta preencher credenciais reais e
  subir no ar (Supabase → deploy → tokens das integrações).
- Módulos de negócio (Financeiro, Resultado por Projeto, Contratos, Unidades NETR, RH,
  Comercial, Dashboard Executivo): **não iniciados**.

## Stack e decisões

- **Frontend:** React + Vite + TypeScript → Vercel. SPA, Tailwind, React Router.
- **Backend:** Node + Express + TypeScript (CommonJS) → Railway.
- **Banco/Auth:** Supabase (PostgreSQL + Supabase Auth, login email/senha).
- **IA:** API do Claude (Anthropic) — Haiku (rápido/alertas) e Sonnet (relatórios).
- **Credenciais:** sempre em `.env` (ver `.env.example` em cada app). `service_role` do
  Supabase e tokens OAuth ficam SÓ no backend; o frontend usa apenas a `anon key`.
- Código e comentários em **português**.

## Estrutura de pastas

```
backend/
  src/
    index.ts                # bootstrap Express + agendador (node-cron diário 05:00)
    config/env.ts           # lê/valida variáveis de ambiente
    config/supabase.ts      # supabaseAdmin (service_role) + validarTokenUsuario
    middleware/auth.ts      # valida JWT do Supabase (Bearer)
    middleware/erros.ts     # tratador central de erros
    rotas/saude.rotas.ts        # GET /api/saude
    rotas/auth.rotas.ts         # GET /api/auth/eu
    rotas/integracoes.rotas.ts  # status, testar, sincronizar, OAuth
    integracoes/            # 1 conector por provedor + index (registro)
      contaAzul.ts (OAuth, ASS+NETR), googleDrive.ts (OAuth),
      pipedrive.ts (token), clockify.ts (key), claude.ts (Anthropic),
      persistencia.ts (salva/lê tokens em integracao_config)
    servicos/sincronizacao.ts   # sync diária (esqueleto) + manual
    servicos/logSync.ts         # auditoria em sync_log
    tipos/integracao.ts
  railway.json, .env.example, tsconfig.json
frontend/
  src/
    main.tsx, App.tsx (rotas)
    lib/supabase.ts         # client (anon key)
    lib/api.ts              # fetch wrapper (injeta token Supabase)
    contextos/AuthContext.tsx
    componentes/RotaProtegida.tsx, Layout.tsx (sidebar)
    paginas/Login.tsx, Dashboard.tsx, Integracoes.tsx
  vercel.json (SPA rewrite), .env.example, vite/tailwind/postcss configs
supabase/migrations/0001_esqueleto.sql
```

## Banco — tabelas (migration 0001)

| Tabela              | Função |
| ------------------- | ------ |
| `empresas`          | ASS e NETR (seed inserido). |
| `perfil_usuario`    | Estende `auth.users` (nome, papel). |
| `integracao_config` | Tokens/credenciais por provedor (jsonb). Só backend (service_role). |
| `sync_log`          | Auditoria das sincronizações. |

RLS habilitado em todas. `integracao_config` sem policy para usuário comum (protegida).

## Endpoints (todos sob `/api`)

| Método | Rota | Auth | Descrição |
| ------ | ---- | ---- | --------- |
| GET  | `/saude` | não | Health check. |
| GET  | `/auth/eu` | sim | Usuário autenticado. |
| GET  | `/integracoes/status` | sim | Status de todos os provedores. |
| GET  | `/integracoes/:provedor/testar` | sim | Testa um provedor. |
| POST | `/integracoes/sincronizar` | sim | Dispara sync manual. |
| GET  | `/integracoes/:provedor/conectar` | não | Inicia OAuth (redireciona). |
| GET  | `/integracoes/:provedor/callback` | não | Recebe code, salva token. |

Provedores: `conta_azul_ass`, `conta_azul_netr`, `pipedrive`, `clockify`,
`google_drive`, `claude`.

## Integrações — status de implementação

| Provedor | Auth | Fase 1 |
| -------- | ---- | ------ |
| Pipedrive | API token | Teste de conexão ✅ |
| Clockify | API key | Teste de conexão ✅ |
| Claude | API key | Cliente + teste ✅ |
| Conta Azul ASS | OAuth2 | Fluxo + teste ✅ (confirmar endpoints no registro) |
| Conta Azul NETR | OAuth2 | Fluxo + teste ✅ (confirmar endpoints no registro) |
| Google Drive | OAuth2 | Fluxo + teste ✅ (escopo readonly) |

CSVs (Uber, 99, planilhas de NF/unidades/planejamento): entram nos módulos, via upload.

## Como rodar local

```bash
# backend
cd backend && cp .env.example .env   # preencher credenciais
npm install && npm run dev           # http://localhost:3333/api/saude

# frontend (outro terminal)
cd frontend && cp .env.example .env  # preencher VITE_*
npm install && npm run dev           # http://localhost:5173
```

Crie o usuário inicial em Supabase > Authentication > Users (ou Sign Up) e rode a
migration `supabase/migrations/0001_esqueleto.sql` no SQL Editor.

## Deploy

- **Railway** (backend): root `backend/`, build `npm run build`, start `npm run start`.
  Variáveis do `.env` no painel. `FRONTEND_URL` = URL do Vercel. Ajustar
  `*_REDIRECT_BASE` para a URL pública do Railway.
- **Vercel** (frontend): root `frontend/`, framework Vite. `VITE_API_URL` = URL do
  Railway; `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- Nas configs OAuth (Conta Azul, Google), cadastrar os redirect URIs de produção:
  `https://<railway>/api/integracoes/<provedor>/callback`.

## Pendências da Fase 1 (próximos passos)

1. Criar projeto Supabase, rodar migration, preencher `.env`.
2. Criar repositório GitHub e subir o código.
3. Deploy Railway (backend) + Vercel (frontend).
4. Preencher tokens simples (Pipedrive, Clockify, Anthropic) e testar.
5. Registrar apps OAuth (Conta Azul ASS/NETR, Google Drive) e conectar.
