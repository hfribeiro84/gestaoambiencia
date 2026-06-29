import type {
  Empresa, NfPlanilha, NfEmitida, ItemConferencia, ResultadoConferencia, AssociacaoManual,
} from './nfTypes';
import { chaveItemPlanilha, SEM_PAR } from './nfTypes';

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
  const pjP = campo.match(/pj\d+-\d+/)?.[0];
  const pjC = caNorm.match(/pj\d+-\d+/)?.[0];
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
  associacoesManuais: AssociacaoManual[] = [],
): ItemConferencia[] {
  const matchados = new Set<string>();  // ca.id já usado
  const usados = new Set<number>();     // índice na planilha já usado (suporta itens duplicados)
  const itens: ItemConferencia[] = [];

  const escolherMatch = empresa === 'netr'
    ? (nfP: NfPlanilha, ca: NfEmitida) => matchPorCnpj(nfP, ca, aliquotaISS)
    : (nfP: NfPlanilha, ca: NfEmitida) => matchAss(nfP, ca);

  // 1. Associações manuais — têm prioridade absoluta sobre o matching automático.
  //    caId === SEM_PAR força o item a ficar Pendente (bloqueia re-match automático).
  for (const assoc of associacoesManuais) {
    const pIdx = planilha.findIndex((p, i) => chaveItemPlanilha(p) === assoc.chaveItem && !usados.has(i));
    if (pIdx === -1) continue;

    usados.add(pIdx);
    const nfP = planilha[pIdx];

    if (assoc.caId === SEM_PAR) {
      itens.push({ status: 'pendente', planilha: nfP });
      continue;
    }

    const ca = contaAzul.find((c) => c.id === assoc.caId);
    if (!ca || matchados.has(ca.id)) continue;

    matchados.add(ca.id);
    const valorOk = valorProximo(ca.valor, vliq(nfP, aliquotaISS));
    itens.push({
      status: valorOk ? 'conferido' : 'conferido_diferenca',
      planilha: nfP,
      contaAzul: ca,
      associacaoManual: true,
    });
  }

  // 2. Matching automático nos itens restantes (por índice — não pula duplicatas).
  for (let i = 0; i < planilha.length; i++) {
    if (usados.has(i)) continue;
    const nfP = planilha[i];
    const match = contaAzul.find((ca) => !matchados.has(ca.id) && escolherMatch(nfP, ca));
    if (match) {
      matchados.add(match.id);
      usados.add(i);
      const valorOk = valorProximo(match.valor, vliq(nfP, aliquotaISS));
      itens.push({ status: valorOk ? 'conferido' : 'conferido_diferenca', planilha: nfP, contaAzul: match });
    } else {
      usados.add(i);
      itens.push({ status: 'pendente', planilha: nfP });
    }
  }

  // 3. NFs do CA sem par na planilha.
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
  associacoesManuais: AssociacaoManual[] = [],
): ResultadoConferencia {
  const itens = erroApi
    ? planilha.map((p) => ({ status: 'pendente' as const, planilha: p }))
    : conferirNfs(empresa, planilha, contaAzul, aliquotaISS, associacoesManuais);

  return {
    empresa, mes, ano,
    aliquotaISS,
    totalPlanilha: planilha.length,
    totalContaAzul: contaAzul.length,
    conferidos: itens.filter((i) => i.status === 'conferido').length,
    conferidosDiferenca: itens.filter((i) => i.status === 'conferido_diferenca').length,
    pendentes: itens.filter((i) => i.status === 'pendente').length,
    naoEsperadas: itens.filter((i) => i.status === 'nao_esperada').length,
    itens,
    erroApi,
    erroSalvar,
  };
}
