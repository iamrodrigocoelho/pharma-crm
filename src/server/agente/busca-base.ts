




import 'server-only'
import { db } from '@/server/db'
import { embedar } from '@/server/agente/embed'
import { ORCAMENTO_BUSCA_MS } from '@/server/agente/orcamento'
import type { AchadoDaBase } from '@/lib/canais/bloco-conhecimento'


const TETO_CONSULTA = 1000


const LIMITE = 5


export type TiposDaBusca = ReadonlyArray<'fato' | 'playbook'> | null


export const TIPOS_DO_BLOCO_AUTOMATICO: TiposDaBusca = ['fato']


// 🔴 O EMBEDDING VAI COMO TEXTO, NÃO COMO ARRAY. O parâmetro é `extensions.vector`,
// e um array JS é codificado pelo driver como ARRAY DO POSTGRES (`0.1,0.2,…`), que o
// pgvector recusa: `invalid input syntax for type vector`. O formato que ele lê é o
// literal entre colchetes. O PostgREST fazia essa conversão sozinho, por isso o
// array cru funcionava antes.
function literalDeVetor(v: readonly number[] | null | undefined): string | null {
  return v && v.length > 0 ? `[${v.join(',')}]` : null
}


export async function buscarNaBase(
  ws: string,
  consulta: string,
  opts: { conversaId: string | null; tipos: TiposDaBusca; assistenteId: string | null },
): Promise<AchadoDaBase[] | 'indisponivel'> {
  const texto = (consulta ?? '').trim().slice(0, TETO_CONSULTA)
  
  
  
  
  
  
  
  
  
  const prazo = AbortSignal.timeout(ORCAMENTO_BUSCA_MS)
  try {
    
    
    const vetor = await embedar(texto, { ws, conversaId: opts.conversaId, sinal: prazo })

    const { data, error } = await db().rpc('base_conhecimento_buscar', {
      p_ws: ws,
      p_query: texto,
      p_embedding: literalDeVetor(vetor?.vetor),
      
      
      p_versao: vetor?.versao ?? null,
      p_limite: LIMITE,
      
      
      p_tipos: opts.tipos === null ? null : [...opts.tipos],
      
      
      
      
      
      p_assistente: opts.assistenteId,
    })
      
      
      
      .abortSignal(prazo)
    
    
    if (error || !data) return 'indisponivel'

    return (data as Array<{ titulo?: string; conteudo?: string; tipo?: string }>).map((l) => ({
      titulo: String(l.titulo ?? ''),
      conteudo: String(l.conteudo ?? ''),
      
      
      tipo: l.tipo === 'playbook' ? 'playbook' : 'fato',
    }))
  } catch {
    return 'indisponivel'
  }
}
