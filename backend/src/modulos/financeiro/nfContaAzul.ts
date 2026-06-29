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
  data_competencia: string;
  status: string;
  nome_cliente: string;
  documento_cliente: string;
  valor_total_nfse: number;
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

      for (const item of itens) {
        if (idsVistos.has(item.id)) continue;
        idsVistos.add(item.id);
        if (!STATUS_VALIDOS.has(item.status)) continue;

        nfs.push({
          id: item.id,
          numero: String(item.numero_nfse ?? ''),
          dataEmissao: item.data_competencia ?? '',
          status: item.status,
          cliente: item.nome_cliente ?? '',
          cnpj: (item.documento_cliente ?? '').replace(/\D/g, ''),
          valor: item.valor_total_nfse ?? 0,
        });
      }

      if (pagina >= (data.paginacao?.total_paginas ?? 1)) break;
      pagina++;
    }
  }

  return nfs;
}
