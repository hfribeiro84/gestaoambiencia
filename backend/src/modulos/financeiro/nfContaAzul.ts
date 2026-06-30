/**
 * Busca NFS-e emitidas no Conta Azul para um dado mês.
 *
 * Endpoint: GET /v1/notas-fiscais-servico
 * Limite da API: range máximo de 15 dias por requisição.
 * Solução: duas chamadas por mês (dias 1-15 e 16-último).
 */
import { chamadaApi } from '../../integracoes/contaAzul';
import type { Empresa, NfEmitida } from './nfTypes';

const ENDPOINT = '/v1/notas-fiscais-servico';

const STATUS_VALIDOS = new Set(['EMITIDA', 'CORRIGIDA_SUCESSO']);

interface ItemNfse {
  id: string;
  numero_nfse: number;
  numero_rps?: number | string;
  data_competencia: string;
  status: string;
  nome_cliente: string;
  documento_cliente: string;
  valor_total_nfse: number;
  [extra: string]: unknown;
}

/** Só dígitos (normaliza CNPJ/CPF para comparação). */
function soDigitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

/**
 * Procura, na nota crua do CA, os dados do prestador (empresa emitente).
 * O CA pode expor isso sob nomes variados (prestador, emitente, etc.) ou não
 * expor — daí a busca defensiva por chaves que contenham "prestador"/"emitente".
 */
function extrairEmitente(raw: Record<string, unknown>): { nome?: string; cnpj?: string } {
  for (const [chave, valor] of Object.entries(raw)) {
    const k = chave.toLowerCase();
    if (!k.includes('prestador') && !k.includes('emitente')) continue;

    // Campo aninhado (objeto com nome/documento) ou valor direto (string)
    if (valor && typeof valor === 'object') {
      const obj = valor as Record<string, unknown>;
      const nome = obj.nome ?? obj.razao_social ?? obj.nome_fantasia;
      const doc = obj.documento ?? obj.cnpj ?? obj.cpf_cnpj;
      return { nome: nome != null ? String(nome) : undefined, cnpj: doc != null ? soDigitos(doc) : undefined };
    }
    if (k.includes('documento') || k.includes('cnpj')) return { cnpj: soDigitos(valor) };
    if (k.includes('nome') || k.includes('razao')) return { nome: String(valor) };
  }
  return {};
}

interface RespostaNfse {
  itens: ItemNfse[];
  paginacao: {
    pagina_atual: number;
    total_paginas: number;
    total_itens: number;
  };
}

function periodos(mes: number, ano: number): { de: string; ate: string }[] {
  const mm = String(mes).padStart(2, '0');
  const ultimo = String(new Date(ano, mes, 0).getDate()).padStart(2, '0');
  return [
    { de: `${ano}-${mm}-01`, ate: `${ano}-${mm}-15` },
    { de: `${ano}-${mm}-16`, ate: `${ano}-${mm}-${ultimo}` },
  ];
}

export async function buscarNfsEmitidas(empresa: Empresa, mes: number, ano: number): Promise<NfEmitida[]> {
  const conta = empresa === 'ass' ? 'ass' : 'netr';
  const nfs: NfEmitida[] = [];
  const idsVistos = new Set<string>();
  const camposCrus: string[] = [];

  for (const periodo of periodos(mes, ano)) {
    let pagina = 1;

    while (true) {
      const resp = await chamadaApi(conta, ENDPOINT, {
        data_competencia_de: periodo.de,
        data_competencia_ate: periodo.ate,
        pagina: String(pagina),
        tamanho_pagina: '100',
      });

      if (!resp.ok) {
        if (resp.status === 403) {
          throw new Error(
            `Conta Azul: acesso negado (403) ao endpoint de NFS-e. ` +
            `O token OAuth não tem permissão para notas fiscais. ` +
            `Acesse Integrações e clique em "Reconectar" no Conta Azul para obter um novo token.`
          );
        }
        const corpo = await resp.text();
        throw new Error(`Conta Azul API ${resp.status}: ${corpo.slice(0, 200)}`);
      }

      const data = (await resp.json()) as RespostaNfse;
      const itens = data.itens ?? [];

      // Guarda os nomes dos campos da 1ª nota crua (diagnóstico de schema do CA).
      if (camposCrus.length === 0 && itens.length > 0) {
        camposCrus.push(...Object.keys(itens[0]));
      }

      for (const item of itens) {
        if (idsVistos.has(item.id)) continue;
        idsVistos.add(item.id);
        if (!STATUS_VALIDOS.has(item.status)) continue;

        const emit = extrairEmitente(item);
        nfs.push({
          id: item.id,
          numero: String(item.numero_nfse ?? ''),
          numeroRps: item.numero_rps != null ? String(item.numero_rps) : '',
          dataEmissao: item.data_competencia ?? '',
          status: item.status,
          cliente: item.nome_cliente ?? '',
          cnpj: (item.documento_cliente ?? '').replace(/\D/g, ''),
          valor: item.valor_total_nfse ?? 0,
          emitenteNome: emit.nome,
          emitenteCnpj: emit.cnpj,
          cidadeEmissao: item.cidade_emissao != null ? String(item.cidade_emissao) : undefined,
          cnae: item.codigo_cnae != null ? String(item.codigo_cnae) : undefined,
        });
      }

      if (pagina >= (data.paginacao?.total_paginas ?? 1)) break;
      pagina++;
    }
  }

  // Anexa os campos crus à 1ª nota para diagnóstico no frontend.
  if (nfs.length > 0 && camposCrus.length > 0) nfs[0]._camposCrus = camposCrus;

  return nfs;
}
