-- Migration 0012: cache das baixas (pagamentos/recebimentos) por parcela
-- Evita rebuscar a baixa de cada parcela no Conta Azul a cada atualização do
-- extrato. Invalidação por `data_alteracao`: se a parcela mudou no CA, o cache
-- é ignorado e a baixa é rebuscada.

CREATE TABLE IF NOT EXISTS dre_baixa_cache (
  empresa        text NOT NULL CHECK (empresa IN ('ass','netr')),
  parcela_id     text NOT NULL,
  data_alteracao text NOT NULL DEFAULT '',
  baixas         jsonb NOT NULL DEFAULT '[]',
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, parcela_id)
);

ALTER TABLE dre_baixa_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acesso autenticado" ON dre_baixa_cache FOR ALL TO authenticated USING (true) WITH CHECK (true);
