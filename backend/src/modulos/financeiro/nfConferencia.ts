import type { Empresa, NfPlanilha, NfEmitida, ItemConferencia, ResultadoConferencia } from './nfTypes';

function normNome(nome: string): string {
  return (nome ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normCnpj(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

/** Valor líquido: desconta ISS quando há retenção e alíquota informada. */
function vliq(planilha: NfPlanilha, aliquotaISS: number): number {
  return planilha.retencaoISS && aliquotaISS > 0
    ? planilha.valorTotal * (1 - aliquotaISS / 100)
    : planilha.valorTotal;
}

function valorProximo(a: number, b: number): boolean {
  if (a === 0 && b === 0) return true;
  return Math.abs(a - b) < 1.0; // ±R$1,00
}

function matchPorCnpj(planilha: NfPlanilha, ca: NfEmitida, aliquotaISS: number): boolean {
  const cnpjP = normCnpj(planilha.cnpj ?? '');
  const cnpjC = normCnpj(ca.cnpj ?? '');
  if (!(cnpjP.length > 0 && cnpjP === cnpjC)) return false;
  return valorProximo(ca.valor, vliq(planilha, aliquotaISS));
}

/**
 * Verifica se o campo da planilha bate com o nome_cliente do CA.
 * O CA pode ter "Projeto - Razão Social", então CA pode CONTER o projeto.
 * Ordem: substring → código PJ (fallback quando nomes diferem mas PJ igual).
 */
function campoMatchCa(campo: string, caNorm: string): boolean {
  if (!campo || campo.length < 4) return false;
  if (caNorm.includes(campo) || campo.includes(caNorm)) return true;
  const pjP = campo.match(/pj\d+/)?.[0];
  const pjC = caNorm.match(/pj\d+/)?.[0];
  return pjP !== undefined && pjC !== undefined && pjP === pjC;
}

function matchAss(planilha: NfPlanilha, ca: NfEmitida): boolean {
  const caNorm = normNome(ca.cliente);
  if (!caNorm) return false;
  // Matching só por nome — diferença de valor é mostrada na tabela
  return campoMatchCa(normNome(planilha.cliente), caNorm)
    || campoMatchCa(normNome(planilha.descricao ?? ''), caNorm);
}

export function conferirNfs(
  empresa: Empresa,
  planilha: NfPlanilha[],
  contaAzul: NfEmitida[],
  aliquotaISS = 0,
): ItemConferencia[] {
  const matchados = new Set<string>();
  const itens: ItemConferencia[] = [];

  const escolherMatch = empresa === 'netr'
    ? (nfP: NfPlanilha, ca: NfEmitida) => matchPorCnpj(nfP, ca, aliquotaISS)
    : (nfP: NfPlanilha, ca: NfEmitida) => matchAss(nfP, ca);

  for (const nfP of planilha) {
    const match = contaAzul.find((ca) => !matchados.has(ca.id) && escolherMatch(nfP, ca));
    if (match) {
      matchados.add(match.id);
      itens.push({ status: 'conferido', planilha: nfP, contaAzul: match });
    } else {
      itens.push({ status: 'pendente', planilha: nfP });
    }
  }

  for (const ca of contaAzul) {
    if (!matchados.has(ca.id)) {
      itens.push({ status: 'nao_esperada', contaAzul: ca });
    }
  }

  return itens;
}

export function calcularResultado(
  empresa: Empresa,
  mes: number,
  ano: number,
  planilha: NfPlanilha[],
  contaAzul: NfEmitida[],
  aliquotaISS = 0,
  erroApi?: string,
  erroSalvar?: string,
): ResultadoConferencia {
  const itens = erroApi
    ? planilha.map((p) => ({ status: 'pendente' as const, planilha: p }))
    : conferirNfs(empresa, planilha, contaAzul, aliquotaISS);

  return {
    empresa, mes, ano,
    aliquotaISS,
    totalPlanilha: planilha.length,
    totalContaAzul: contaAzul.length,
    conferidos: itens.filter((i) => i.status === 'conferido').length,
    pendentes: itens.filter((i) => i.status === 'pendente').length,
    naoEsperadas: itens.filter((i) => i.status === 'nao_esperada').length,
    itens,
    erroApi,
    erroSalvar,
  };
}
