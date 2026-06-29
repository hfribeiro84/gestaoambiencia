-- Guarda associações manuais planilha ↔ CA na própria linha da planilha salva.
-- Cada entrada: { chaveItem: string, caId: string }
-- chaveItem = "${cliente}|${descricao}|${valorTotal}" (chave estável do item da planilha)
ALTER TABLE nf_planilha_salva
ADD COLUMN IF NOT EXISTS associacoes_manuais jsonb NOT NULL DEFAULT '[]'::jsonb;
