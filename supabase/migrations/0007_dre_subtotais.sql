-- Subtotais configuráveis da DRE
-- Linhas calculadas (ex: "= Resultado Operacional") que aparecem
-- após cada grupo de categorias, editáveis e reposicionáveis.

CREATE TABLE IF NOT EXISTS dre_subtotal (
  id        UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  nome      TEXT    NOT NULL,
  formula   TEXT    NOT NULL CHECK (formula IN ('receita_liquida','resultado_operacional','resultado_liquido','fluxo_caixa_livre')),
  apos_tipo TEXT    NOT NULL CHECK (apos_tipo IN ('receita','deducao','custo','despesa','financeiro','divisao')),
  ordem     INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE dre_subtotal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acesso autenticado" ON dre_subtotal FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Subtotais padrão (espelham o que estava hardcoded no frontend)
INSERT INTO dre_subtotal (nome, formula, apos_tipo, ordem) VALUES
  ('= Receita Líquida',      'receita_liquida',     'deducao',    1),
  ('= Resultado Operacional','resultado_operacional','despesa',    1),
  ('= Resultado Líquido',    'resultado_liquido',   'financeiro', 1),
  ('= Fluxo de Caixa Livre', 'fluxo_caixa_livre',  'divisao',    1);
