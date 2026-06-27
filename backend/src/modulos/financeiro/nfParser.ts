/**
 * Parseia os CSVs de "NF a emitir" da ASS e da NETR.
 *
 * ASS:  colunas fixas — B=EmissaoNF, C=Organização, D=Projeto, G=ValorRecorrente,
 *       H=ValorEstudos, N=RetencaoISS. Primeira linha vazia, segunda é cabeçalho.
 *
 * NETR: colunas fixas — B=EmissaoNF, C=Empresa, E=Unidade, G=CNPJ,
 *       H=ValorMensal, I=RetencaoISS, J=ValorCobrança. Primeira linha é
 *       metadado, segunda é cabeçalho com células multiline.
 */
import { parse } from 'csv-parse/sync';
import type { NfPlanilha } from './nfTypes';

function parseBRL(valor: string): number {
  if (!valor || valor.trim() === '' || valor.trim() === '-') return 0;
  const limpo = valor.replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.').trim();
  return parseFloat(limpo) || 0;
}

function normEmissao(valor: string): string {
  return (valor ?? '').trim().toUpperCase();
}

function parseLinhas(csv: string): string[][] {
  return parse(csv, {
    skip_empty_lines: false,
    relax_column_count: true,
    relax_quotes: true,
  }) as string[][];
}

export function parseCsvAss(csv: string): NfPlanilha[] {
  const linhas = parseLinhas(csv);
  // Linha 0: vazia; Linha 1: cabeçalho → dados a partir da linha 2
  const dados = linhas.slice(2);
  const resultado: NfPlanilha[] = [];

  for (const row of dados) {
    const cliente = (row[2] ?? '').trim();
    if (!cliente) continue;

    const valorRec = parseBRL(row[6] ?? '');
    const valorOut = parseBRL(row[7] ?? '');
    const valorTotal = valorRec + valorOut;
    if (valorTotal === 0) continue;

    resultado.push({
      emissaoNF: normEmissao(row[1] ?? ''),
      cliente,
      descricao: (row[3] ?? '').trim(),
      valorTotal,
      retencaoISS: (row[13] ?? '').trim().toUpperCase() === 'SIM',
    });
  }
  return resultado;
}

export function parseCsvNetr(csv: string): NfPlanilha[] {
  const linhas = parseLinhas(csv);
  // Linha 0: metadado; Linha 1: cabeçalho (multiline) → dados a partir da linha 2
  const dados = linhas.slice(2);
  const resultado: NfPlanilha[] = [];

  for (const row of dados) {
    const empresa = (row[2] ?? '').trim();
    if (!empresa) continue;

    const valorTotal = parseBRL(row[9] ?? '');
    if (valorTotal === 0) continue;

    resultado.push({
      emissaoNF: normEmissao(row[1] ?? ''),
      cliente: empresa,
      descricao: (row[4] ?? '').trim(),
      cnpj: (row[6] ?? '').replace(/\D/g, ''),
      valorTotal,
      retencaoISS: (row[8] ?? '').trim().toUpperCase() === 'SIM',
    });
  }
  return resultado;
}
