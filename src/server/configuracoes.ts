import 'server-only'
import { db } from '@/server/db'



export async function lerConfig(chave: string): Promise<string | null> {
  const { data } = await db()
    .from('settings')
    .select('value')
    .eq('key', chave)
    .maybeSingle()
  return (data?.value as string | null) ?? null
}

export async function gravarConfig(chave: string, valor: string): Promise<void> {
  await db()
    .from('settings')
    .upsert({ key: chave, value: valor }, { onConflict: 'key' })
}
