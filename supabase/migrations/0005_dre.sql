-- Migration 0005: DRE Gerencial
-- Tabelas de categorias, mapeamentos e snapshots do DRE.

CREATE TABLE IF NOT EXISTS dre_categoria (
  id          uuid PRIMARY KEY,
  nome        text NOT NULL,
  pai_id      uuid REFERENCES dre_categoria(id) ON DELETE SET NULL,
  ordem       int NOT NULL DEFAULT 0,
  tipo        text NOT NULL CHECK (tipo IN ('receita','deducao','custo','despesa','financeiro','divisao')),
  sinal       int NOT NULL DEFAULT -1,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dre_mapeamento (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa      text NOT NULL,
  nome_ca      text NOT NULL,
  categoria_id uuid NOT NULL REFERENCES dre_categoria(id) ON DELETE CASCADE,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa, nome_ca)
);

CREATE TABLE IF NOT EXISTS dre_snapshot (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa       text NOT NULL,
  mes_ref       int NOT NULL,
  ano_ref       int NOT NULL,
  calculado_em  timestamptz NOT NULL DEFAULT now(),
  dados         jsonb NOT NULL
);

-- RLS
ALTER TABLE dre_categoria  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dre_mapeamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE dre_snapshot   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acesso autenticado" ON dre_categoria  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "acesso autenticado" ON dre_mapeamento FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "acesso autenticado" ON dre_snapshot   FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────
-- SEED: árvore de categorias com UUIDs fixos
-- ─────────────────────────────────────────

-- Nível 1 (raiz)
INSERT INTO dre_categoria (id, nome, pai_id, ordem, tipo, sinal) VALUES
  ('dre00001-0000-0000-0000-000000000000', 'Receita Bruta (Serviços)',     NULL, 10, 'receita',    1),
  ('dre00002-0000-0000-0000-000000000000', 'Deduções da Receita Bruta',    NULL, 20, 'deducao',   -1),
  ('dre00003-0000-0000-0000-000000000000', 'Custos Projetos',              NULL, 30, 'custo',     -1),
  ('dre00004-0000-0000-0000-000000000000', 'Despesas',                     NULL, 40, 'despesa',   -1),
  ('dre00005-0000-0000-0000-000000000000', 'Operação Financeira',          NULL, 50, 'financeiro',-1),
  ('dre00006-0000-0000-0000-000000000000', 'Divisão de Resultados',        NULL, 60, 'divisao',   -1)
ON CONFLICT (id) DO NOTHING;

-- Subcategorias de Receita Bruta
INSERT INTO dre_categoria (id, nome, pai_id, ordem, tipo, sinal) VALUES
  ('dre01001-0000-0000-0000-000000000000', 'Setor 1 - GRCC - Acompanhamento obras (RMBH)', 'dre00001-0000-0000-0000-000000000000', 11, 'receita', 1),
  ('dre01002-0000-0000-0000-000000000000', 'Setor 1 - GRCC - PGRCC (RMBH)',               'dre00001-0000-0000-0000-000000000000', 12, 'receita', 1),
  ('dre01003-0000-0000-0000-000000000000', 'Setor 1 - Relatórios',                         'dre00001-0000-0000-0000-000000000000', 13, 'receita', 1),
  ('dre01004-0000-0000-0000-000000000000', 'Setor 1 - GAC',                                'dre00001-0000-0000-0000-000000000000', 14, 'receita', 1),
  ('dre01005-0000-0000-0000-000000000000', 'Setor 1 - Educação Ambiental',                 'dre00001-0000-0000-0000-000000000000', 15, 'receita', 1),
  ('dre01006-0000-0000-0000-000000000000', 'Setor 1 - Outros',                             'dre00001-0000-0000-0000-000000000000', 16, 'receita', 1),
  ('dre01007-0000-0000-0000-000000000000', 'Setor 2 - Licitações',                         'dre00001-0000-0000-0000-000000000000', 17, 'receita', 1),
  ('dre01008-0000-0000-0000-000000000000', 'Setor 2 - Outros',                             'dre00001-0000-0000-0000-000000000000', 18, 'receita', 1),
  ('dre01009-0000-0000-0000-000000000000', 'Coworking',                                    'dre00001-0000-0000-0000-000000000000', 19, 'receita', 1),
  ('dre01010-0000-0000-0000-000000000000', 'Vendas',                                       'dre00001-0000-0000-0000-000000000000', 20, 'receita', 1)
ON CONFLICT (id) DO NOTHING;

-- Subcategorias de Deduções
INSERT INTO dre_categoria (id, nome, pai_id, ordem, tipo, sinal) VALUES
  ('dre02001-0000-0000-0000-000000000000', 'Impostos sob NF', 'dre00002-0000-0000-0000-000000000000', 21, 'deducao', -1),
  ('dre02002-0000-0000-0000-000000000000', 'Comissões',       'dre00002-0000-0000-0000-000000000000', 22, 'deducao', -1)
ON CONFLICT (id) DO NOTHING;

-- Subcategorias de Custos Projetos
INSERT INTO dre_categoria (id, nome, pai_id, ordem, tipo, sinal) VALUES
  ('dre03001-0000-0000-0000-000000000000', 'Custos Projetos (Diversos)', 'dre00003-0000-0000-0000-000000000000', 31, 'custo', -1)
ON CONFLICT (id) DO NOTHING;

-- Subcategorias de Despesas (nível 2)
INSERT INTO dre_categoria (id, nome, pai_id, ordem, tipo, sinal) VALUES
  ('dre04001-0000-0000-0000-000000000000', 'Equipe Técnica e Despesas Operacionais', 'dre00004-0000-0000-0000-000000000000', 41, 'despesa', -1),
  ('dre04002-0000-0000-0000-000000000000', 'Despesas Comerciais',                    'dre00004-0000-0000-0000-000000000000', 42, 'despesa', -1),
  ('dre04003-0000-0000-0000-000000000000', 'Despesas Administrativas e Apoio',       'dre00004-0000-0000-0000-000000000000', 43, 'despesa', -1),
  ('dre04004-0000-0000-0000-000000000000', 'Despesas Gestão',                        'dre00004-0000-0000-0000-000000000000', 44, 'despesa', -1)
ON CONFLICT (id) DO NOTHING;

-- Subcategorias de Despesas (nível 3)
INSERT INTO dre_categoria (id, nome, pai_id, ordem, tipo, sinal) VALUES
  -- Equipe Técnica
  ('dre04101-0000-0000-0000-000000000000', 'Equipe - Área Técnica',              'dre04001-0000-0000-0000-000000000000', 411, 'despesa', -1),
  ('dre04102-0000-0000-0000-000000000000', 'Equipe - outras despesas',            'dre04001-0000-0000-0000-000000000000', 412, 'despesa', -1),
  ('dre04103-0000-0000-0000-000000000000', 'Despesas - Apoio operação (Equipe)', 'dre04001-0000-0000-0000-000000000000', 413, 'despesa', -1),
  -- Comercial
  ('dre04201-0000-0000-0000-000000000000', 'MKT / Comercial',                       'dre04002-0000-0000-0000-000000000000', 421, 'despesa', -1),
  ('dre04202-0000-0000-0000-000000000000', 'Despesas - Apoio operação (Comercial)', 'dre04002-0000-0000-0000-000000000000', 422, 'despesa', -1),
  -- Administrativas
  ('dre04301-0000-0000-0000-000000000000', 'Despesas Administrativas (diversas)', 'dre04003-0000-0000-0000-000000000000', 431, 'despesa', -1),
  ('dre04302-0000-0000-0000-000000000000', 'Despesas Bancárias',                  'dre04003-0000-0000-0000-000000000000', 432, 'despesa', -1),
  ('dre04303-0000-0000-0000-000000000000', 'Escritório',                           'dre04003-0000-0000-0000-000000000000', 433, 'despesa', -1),
  ('dre04304-0000-0000-0000-000000000000', 'Estornos - Rateio ASS/NETR',          'dre04003-0000-0000-0000-000000000000', 434, 'despesa',  1),
  -- Gestão
  ('dre04401-0000-0000-0000-000000000000', 'Gestão',                               'dre04004-0000-0000-0000-000000000000', 441, 'despesa', -1),
  ('dre04402-0000-0000-0000-000000000000', 'Despesas - Apoio operação (Gestão)',   'dre04004-0000-0000-0000-000000000000', 442, 'despesa', -1)
ON CONFLICT (id) DO NOTHING;

-- Subcategorias de Operação Financeira (nível 2)
INSERT INTO dre_categoria (id, nome, pai_id, ordem, tipo, sinal) VALUES
  ('dre05001-0000-0000-0000-000000000000', 'Outras Receitas e Receitas Financeiras', 'dre00005-0000-0000-0000-000000000000', 51, 'financeiro',  1),
  ('dre05002-0000-0000-0000-000000000000', 'Dívidas e Empréstimos',                  'dre00005-0000-0000-0000-000000000000', 52, 'financeiro', -1),
  ('dre05003-0000-0000-0000-000000000000', 'Investimentos',                          'dre00005-0000-0000-0000-000000000000', 53, 'financeiro', -1)
ON CONFLICT (id) DO NOTHING;

-- Subcategorias de Operação Financeira (nível 3)
INSERT INTO dre_categoria (id, nome, pai_id, ordem, tipo, sinal) VALUES
  ('dre05201-0000-0000-0000-000000000000', 'Dívidas (diversas)', 'dre05002-0000-0000-0000-000000000000', 521, 'financeiro', -1),
  ('dre05202-0000-0000-0000-000000000000', 'Juros e multas',     'dre05002-0000-0000-0000-000000000000', 522, 'financeiro', -1)
ON CONFLICT (id) DO NOTHING;
