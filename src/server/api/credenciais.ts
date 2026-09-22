import 'server-only'
import { db } from '@/server/db'

export type CredencialRef = { workspace_id: string; revogado_em: string | null }


export async function buscarCredencialPorKeyId(keyId: string): Promise<CredencialRef | null> {
  const { data } = await db()
    .from('credenciais_api')
    .select('workspace_id, revogado_em')
    .eq('key_id', keyId)
    .maybeSingle()
  return (data as CredencialRef | null) ?? null
}
