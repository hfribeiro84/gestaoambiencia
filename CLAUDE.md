# CLAUDE.md — Sistema de Gestão Ambiência

Documentação viva do projeto. **Atualizar a cada sessão** (boa prática obrigatória):
estrutura de pastas, decisões de arquitetura, tabelas do banco e endpoints criados.

## O que é

Plataforma web própria para centralizar a gestão administrativa, financeira, comercial e
operacional da **Ambiência Soluções Sustentáveis (ASS)** e da **NETResíduos (NETR)**.
Visão consolidada do grupo + visão individual por empresa, com análises de IA (Claude).
Desenvolvimento **modular e incremental** — um módulo por vez sobre a fundação.

## Status

- **Fase 1 — Esqueleto: completo localmente.** Estrutura base, autenticação, banco,
  camada de conexão com APIs e configs de deploy prontos. Falta credenciais reais +
  deploy (Supabase → Railway → Vercel).
- **Módulo DRE Gerencial: em produção (local).** Funcional completo com Conta Azul.
- Módulos futuros (Resultado por Projeto, Contratos, Unidades NETR, RH, Comercial,
  Dashboard Executivo): **não iniciados**.

## Stack e decisões

- **Frontend:** React + Vite + TypeScript → Vercel. SPA, Tailwind, React Router.
- **Backend:** Node + Express + TypeScript (CommonJS) → Railway.
- **Banco/Auth:** Supabase (PostgreSQL + Supabase Auth, login email/senha).
- **IA:** API do Claude (Anthropic) — Haiku (rápido/alertas) e Sonnet (relatórios).
- **Credenciais:** sempre em `.env` (ver `.env.example` em cada app). `service_role` do
  Supabase e tokens OAuth ficam SÓ no backend; o frontend usa apenas a `anon key`.
- Código e comentários em **português**.

## Padrões de código adotados

- **Lazy save na aba Configurações do DRE:** todas as edições estruturais (categoria:
  nome, tipo, sinal, pai, ordem; subtotal: nome, fórmula, posição) ficam em estado local
  (`localCats`, `pendingEdits`, `localSubtotais`, `pendingSubtotalEdits`) e só são
  enviadas ao backend quando o usuário clica "Salvar". Badge âmbar mostra o total de
  alterações não salvas. Criar e excluir continuam sendo imediatos (operações que
  precisam de confirmação do servidor).
- **Operações de Create/Delete imediatas** (chamada API → `carregarConfig()`) — apenas
  edições de campos vão pelo lazy save.
- **Componentes de configuração unificados:** a árvore de categorias DRE e os
  mapeamentos CA→DRE vivem no mesmo painel (`EstruturaDRE`). Os chips de mapeamento
  ficam inline em cada nó da árvore. A seção de subtotais também fica no mesmo painel.
- **Subtotais dinâmicos:** antes os subtotais (= Receita Líquida, = Resultado
  Operacional…) eram hardcoded em `LINHAS_CALCULADAS_APOS`. Agora são registros na
  tabela `dre_subtotal`, editáveis/posicionáveis via aba Configurações e lidos pela
  `TabelaDRE` dinamicamente.

## Estrutura de pastas

```
backend/
  src/
    index.ts                     # bootstrap Express + agendadores (node-cron: extrato DRE 04:00, sync 05:00)
    config/env.ts                # lê/valida variáveis de ambiente
    config/supabase.ts           # supabaseAdmin (service_role) + validarTokenUsuario
    middleware/auth.ts           # valida JWT do Supabase (Bearer)
    middleware/erros.ts          # tratador central de erros
    rotas/
      saude.rotas.ts             # GET /api/saude
      auth.rotas.ts              # GET /api/auth/eu
      integracoes.rotas.ts       # status, testar, sincronizar, OAuth
      dre.rotas.ts               # todos os endpoints do módulo DRE
    integracoes/                 # 1 conector por provedor + index (registro)
      contaAzul.ts               # OAuth + chamadas API (ASS+NETR)
      googleDrive.ts             # OAuth
      pipedrive.ts, clockify.ts, claude.ts
      persistencia.ts            # salva/lê tokens em integracao_config
    modulos/financeiro/
      dreCalculo.ts              # cálculo do DRE (lê do extrato salvo, acumula, totais)
      dreContaAzul.ts            # busca lançamentos, saldo, transferências via API CA
      dreExtrato.ts              # gera/salva/lê o extrato materializado (base da DRE)
      dreTypes.ts                # tipos compartilhados do módulo DRE
    servicos/sincronizacao.ts, logSync.ts
    tipos/integracao.ts
  railway.json, .env.example, tsconfig.json

frontend/
  src/
    main.tsx, App.tsx (rotas)
    lib/supabase.ts              # client (anon key)
    lib/api.ts                   # fetch wrapper (injeta token Supabase)
    contextos/AuthContext.tsx
    componentes/RotaProtegida.tsx, Layout.tsx (sidebar)
    paginas/
      Login.tsx, Dashboard.tsx, Integracoes.tsx
      financeiro/
        DREGerencial.tsx         # módulo DRE completo (SPA dentro do SPA)
        NfGerenciador.tsx        # gerenciador de NFs (NETR)
  vercel.json (SPA rewrite), .env.example, vite/tailwind/postcss configs

supabase/migrations/
  0001_esqueleto.sql             # tabelas base (empresas, perfil, integracao_config, sync_log)
  0002_nf_planilha_salva.sql     # tabela nf_planilha_salva
  0003_nf_aliquota_iss.sql       # tabela nf_aliquota_iss
  0004_nf_ultimo_resultado.sql   # tabela nf_ultimo_resultado
  0005_dre.sql                   # tabelas DRE (dre_categoria, dre_mapeamento, dre_snapshot)
  0006_nf_associacao_manual.sql  # associação manual NF ↔ NETR
  0007_dre_subtotais.sql         # tabela dre_subtotal (subtotais configuráveis)
  0008_dre_extrato.sql           # tabelas dre_extrato + dre_extrato_item (base da DRE)
  0009_dre_extrato_atrasados.sql # coluna dre_extrato.atrasados (jsonb) — snapshot de vencidos
  0010_dre_extrato_previsto.sql  # coluna dre_extrato_item.previsto (bool) — caixa x previsto
  0011_nf_planilha_fonte_url.sql # coluna nf_planilha_salva.fonte_url (link Google Sheets)
  0012_dre_baixa_cache.sql       # cache de baixas por parcela (invalidação por data_alteracao)
```

## Banco — tabelas

| Tabela               | Migration | Função |
| -------------------- | --------- | ------ |
| `empresas`           | 0001 | ASS e NETR (seed inserido). |
| `perfil_usuario`     | 0001 | Estende `auth.users` (nome, papel). |
| `integracao_config`  | 0001 | Tokens/credenciais por provedor (jsonb). Só backend. |
| `sync_log`           | 0001 | Auditoria das sincronizações. |
| `nf_planilha_salva`  | 0002/0011 | Planilhas de NF salvas (ASS/NETR), com `fonte_url` opcional (link Google Sheets). |
| `nf_aliquota_iss`    | 0003 | Alíquotas ISS por município. |
| `nf_ultimo_resultado`| 0004 | Cache do último resultado de NF por CNPJ. |
| `dre_categoria`      | 0005 | Árvore de categorias do DRE (pai_id, tipo, sinal, ordem). |
| `dre_mapeamento`     | 0005 | Mapeamento nome_ca → categoria_id, por empresa. |
| `dre_snapshot`       | 0005 | Snapshots calculados do DRE (dados jsonb). |
| `nf_associacao_manual`| 0006 | Associação manual NF ↔ unidade NETR. |
| `dre_subtotal`       | 0007 | Subtotais configuráveis (= Resultado Op., etc.). |
| `dre_extrato`        | 0008/0009 | Metadados do extrato salvo por empresa (período, saldo inicial, atualização, `atrasados` jsonb). |
| `dre_extrato_item`   | 0008 | Lançamentos do extrato salvo (data do pagamento, tipo, categoria, valor, saldo). Base da DRE (caixa). |

RLS habilitado em todas. `integracao_config` sem policy de usuário comum (protegida).

## Endpoints DRE (todos sob `/api/financeiro/dre`, requerem auth exceto indicado)

| Método | Rota | Descrição |
| ------ | ---- | --------- |
| GET  | `/categorias` | Lista todas as categorias (flat, ordenada por `ordem`). |
| POST | `/categorias` | Cria categoria (nome, pai_id, tipo, sinal). |
| PATCH | `/categorias/:id` | Edita nome/pai/tipo/sinal/ordem. |
| DELETE | `/categorias/:id` | Exclui (recusa se tiver filhos ou mapeamentos). |
| GET  | `/subtotais` | Lista todos os subtotais (nome, formula, apos_tipo, ordem). |
| POST | `/subtotais` | Cria subtotal. |
| PATCH | `/subtotais/:id` | Edita nome/formula/apos_tipo/ordem. |
| DELETE | `/subtotais/:id` | Exclui subtotal. |
| GET  | `/mapeamento/:empresa` | Lista mapeamentos CA→DRE (ass/netr). |
| POST | `/mapeamento/:empresa` | Adiciona/atualiza mapeamento (upsert). |
| DELETE | `/mapeamento/:empresa/:id` | Remove mapeamento. |
| GET  | `/categorias-ca/:empresa` | Categorias distintas do CA nos últimos 12 meses. |
| POST | `/calcular/:empresa/:mes/:ano` | Calcula DRE (lê do extrato salvo) e salva snapshot. |
| GET  | `/ultimo/:empresa` | Último snapshot calculado. |
| GET  | `/snapshots/:empresa` | Lista snapshots (id, mes_ref, ano_ref, calculado_em). |
| DELETE | `/snapshots/:empresa/:id` | Exclui snapshot. |
| POST | `/extrato/:empresa` | Busca período no CA (body `de`,`ate`,`saldoInicial`,`reprocessar`), calcula saldo e **substitui** o extrato salvo (completo). |
| POST | `/extrato/:empresa/recente` | Atualização incremental (últimos 2 meses + futuro), mantendo o histórico. |
| GET  | `/extrato/:empresa` | Extrato salvo (metadados + itens com saldo). |
| GET  | `/extrato-meta/:empresa` | Período disponível + data de atualização + resumo de atrasados. |
| GET  | `/debug/parcelas/:empresa/:mes/:ano` | Schema cru de contas-a-receber (parcelas + baixas). |
| GET  | `/resumo/:empresa` | Resumo executivo IA (Haiku) a partir do último snapshot. |
| GET  | `/debug/raw/:empresa/:mes/:ano` | Resposta bruta da API CA (diagnóstico). |
| GET  | `/debug/amostra/:empresa/:mes/:ano` | Amostra de lançamentos parseados. |

## Endpoints infraestrutura (todos sob `/api`)

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

## Módulo DRE — arquitetura

- **Extrato como base (0008), MODELO HÍBRIDO caixa/competência:** o extrato materializado
  (`dre_extrato` + `dre_extrato_item`) é a **fonte única** da DRE — o Conta Azul não é
  consultado a cada cálculo. Regra: **até ontem = caixa** (baixas reais, por `data_pagamento`);
  **de hoje em diante = previsto** (parcelas em aberto, pela `data_vencimento`; itens marcados
  `previsto=true`). Assim a mesma tela mostra realizado (passado) + previsão (futuro), e o saldo
  projeta o futuro. O usuário atualiza por período (modal início/fim). A lista `/buscar` NÃO traz
  baixas; `dreContaAzul.buscarParcelas` lista por vencimento e `enriquecerComBaixas` busca as
  baixas só das parcelas pagas em `/v1/financeiro/eventos-financeiros/parcelas/{id}/baixa`
  (`data_pagamento` + `valor_composicao.valor_liquido`). Chamadas ao CA passam por throttle
  (~8/s) + backoff em 429 (`fetchCA` em `contaAzul.ts`), respeitando o limite de 600/min.
  Substitui o extrato salvo. Abas DRE e Extrato mostram período + atualização. Histórico removido.
- **Cache de baixas + cron noturno (0012):** `enriquecerComBaixas` guarda as baixas em
  `dre_baixa_cache` (chave empresa+parcela_id), invalidando por `data_alteracao` — só rebusca no
  CA o que mudou, deixando as atualizações seguintes rápidas. O botão "Reprocessar tudo" (ou
  `reprocessar:true` no POST) ignora o cache e refaz do zero.
- **Atualização incremental (recente x completo):** `montarEventos(empresa,de,ate)` é a lógica
  comum (caixa+previsto). `gerarESalvarExtrato` faz o COMPLETO (substitui tudo — para (re)construir
  ou estender o histórico / trocar saldo inicial; botão "Alterar período"). `atualizarExtratoRecente`
  faz o INCREMENTAL: congela o histórico e refaz só os últimos `MESES_REFRESH_RECENTE` (=2) meses +
  futuro, continuando o saldo a partir do último item congelado (`POST /extrato/:empresa/recente`;
  botão "Atualizar recente"). O cron das **04:00** (`atualizarExtratosDiario`) usa o incremental —
  rápido mesmo com histórico grande, rola a fronteira caixa/previsto e traz novos pagamentos.
- **Contas em atraso:** `calcularAtrasados()` levanta as parcelas vencidas e ainda em aberto
  (`valorTotal − totalBaixado > 0` e `dataVencimento < hoje`), a receber e a pagar. Snapshot
  salvo em `dre_extrato.atrasados` na atualização do extrato; exibido nas abas DRE e Extrato
  (informativo, **fora** do saldo de caixa).
- **Cálculo:** híbrido — realizado entra no mês do **pagamento** e previsto no mês do
  **vencimento**. `calcularDRE()` lê do **extrato salvo** (`lerLancamentosDoExtrato`; o campo
  `dataVencimento` carrega a data do item — pagamento ou vencimento), acumula por categoria via
  `dre_mapeamento`, soma subcategorias,
  calcula totais (receitaLiquida, resultadoOperacional, resultadoLiquido, fluxoCaixaLivre) e
  salva snapshot em `dre_snapshot`. A DRE fica estática (carrega o último snapshot ao entrar)
  até o usuário clicar "Atualizar".
- **Subtotais:** lidos de `dre_subtotal` no frontend. Cada subtotal tem `apos_tipo`
  (qual grupo de categorias antecede a linha) e `formula` (qual campo de
  `TotaisCalculados` mostrar). `TabelaDRE` os agrupa por `apos_tipo` e renderiza
  dinamicamente em lugar das constantes hardcoded anteriores.
- **Mapeamentos:** globais por empresa — valem para todos os meses e períodos.
  A aba Configurações mostra a árvore de categorias com chips inline dos mapeamentos CA,
  a seção de subtotais configuráveis, e as categorias CA sem mapeamento na parte inferior.
- **Lazy save:** edições na estrutura (categoria + subtotal) ficam em estado local até
  o usuário clicar "Salvar" — uma única rodada de PATCHes sequenciais + 1 reload.

## Integrações — status de implementação

| Provedor | Auth | Status |
| -------- | ---- | ------ |
| Pipedrive | API token | Teste de conexão ✅ |
| Clockify | API key | Teste de conexão ✅ |
| Claude | API key | Cliente + resumo executivo ✅ |
| Conta Azul ASS | OAuth2 | Fluxo completo + DRE ✅ |
| Conta Azul NETR | OAuth2 | Fluxo completo + DRE ✅ |
| Google Drive | OAuth2 | Fluxo OAuth ✅ (conteúdo: futuro) |

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

Crie o usuário inicial em Supabase > Authentication > Users e rode as migrations
`supabase/migrations/` em ordem no SQL Editor.

## Deploy

- **Railway** (backend): root `backend/`, build `npm run build`, start `npm run start`.
  Variáveis do `.env` no painel. `FRONTEND_URL` = URL do Vercel. Ajustar
  `*_REDIRECT_BASE` para a URL pública do Railway.
- **Vercel** (frontend): root `frontend/`, framework Vite. `VITE_API_URL` = URL do
  Railway; `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- Nas configs OAuth (Conta Azul, Google), cadastrar os redirect URIs de produção:
  `https://<railway>/api/integracoes/<provedor>/callback`.

## Pendências

### Fase 1 (infra)
1. Criar projeto Supabase, rodar migrations em ordem, preencher `.env`.
2. Criar repositório GitHub e subir o código.
3. Deploy Railway (backend) + Vercel (frontend).
4. Preencher tokens simples (Pipedrive, Clockify, Anthropic) e testar.
5. Registrar apps OAuth (Conta Azul ASS/NETR, Google Drive) e conectar.

### Próximos módulos
- Resultado por Projeto (rateio de custos/despesas por projeto Pipedrive)
- Contratos (pipeline Pipedrive × faturamento CA)
- Unidades NETR (acompanhamento de obras)
- RH (Clockify × custos)
- Comercial (funil Pipedrive)
- Dashboard Executivo (consolidado do grupo)
