import 'server-only'
import { db } from '@/server/db'
import { usuarioAtual } from '@/server/auth/sessao'


export async function ehOwnerDoWorkspace(ws: string): Promise<boolean> {
  const user = await usuarioAtual()
  if (!user) return false

  const { data } = await db()
    .from('membros')
    .select('id')
    .eq('workspace_id', ws)
    .eq('user_id', user.id)
    .eq('papel', 'owner')
    .maybeSingle()
  return Boolean(data)
}
