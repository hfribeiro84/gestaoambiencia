-- Migration 0008: Extrato materializado do DRE
-- O extrato salvo no banco passa a ser a base de dados da DRE Gerencial,
-- eliminando a consulta ao Conta Azul a cada cálculo. O usuário atualiza o
-- extrato manualmente (por período) e o sistema regrava a tabela.

-- Metadados do extrato salvo, um por empresa (ass/netr).
CREATE TABLE IF NOT EXISTS dre_extrato (
  empresa        text PRIMARY KEY CHECK (empresa IN ('ass','netr')),
  periodo_de     date NOT NULL,
  periodo_ate    date NOT NULL,
  saldo_inicial  numeric NOT NULL DEFAULT 0,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- Lançamentos do extrato (receitas, despesas e transferências) com saldo corrente.
CREATE TABLE IF NOT EXISTS dre_extrato_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa       text NOT NULL CHECK (empresa IN ('ass','netr')),
  lancamento_id text,
  data          date NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('receita','despesa','transferencia')),
  categoria     text NOT NULL DEFAULT '',
  descricao     text NOT NULL DEFAULT '',
  valor         numeric NOT NULL DEFAULT 0,
  saldo         numeric NOT NULL DEFAULT 0,
  ordem         int NOT NULL DEFAULT 0,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

-- Índice para as consultas por empresa + janela de datas (usadas pela DRE).
CREATE INDEX IF NOT EXISTS idx_dre_extrato_item_empresa_data
  ON dre_extrato_item (empresa, data);

-- RLS
ALTER TABLE dre_extrato      ENABLE ROW LEVEL SECURITY;
ALTER TABLE dre_extrato_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acesso autenticado" ON dre_extrato      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "acesso autenticado" ON dre_extrato_item FOR ALL TO authenticated USING (true) WITH CHECK (true);
