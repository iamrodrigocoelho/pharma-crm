import 'server-only'
import { db } from '@/server/db'
import { mostrarLinkDeCadastro } from '@/lib/cadastro-aberto'


export async function ehInstalacaoNova(): Promise<boolean> {
  try {
    const banco = db()
    const { data } = await banco.from('settings').select('value').eq('key', 'bootstrap_feito').maybeSingle()
    if ((data as { value?: string } | null)?.value !== 'false') return false

    
    const { count } = await banco.from('membros').select('*', { count: 'exact', head: true })
    return (count ?? 0) === 0
  } catch {
    return false 
  }
}


export async function podeCadastrarSemConvite(): Promise<boolean> {
  try {
    const banco = db()
    const { data, error } = await banco
      .from('settings')
      .select('key, value')
      .in('key', ['bootstrap_feito', 'signup_aberto'])
    if (error) return true
    const linhas = (data ?? []) as { key?: string; value?: string | null }[]
    const ler = (k: string) => linhas.find((l) => l.key === k)?.value ?? null
    return mostrarLinkDeCadastro({
      bootstrapFeito: ler('bootstrap_feito'),
      signupAberto: ler('signup_aberto'),
    })
  } catch {
    return true 
  }
}
