import 'server-only'
import { db } from '@/server/db'
import { CHAVE_DONO_DEPLOY, decidirDonoDoDeploy, ehODono } from '@/lib/dono-deploy'
import { usuarioAtual } from '@/server/auth/sessao'




export async function reivindicarDonoDoDeploy(userId: string): Promise<void> {
  
  
  
  
  try {
    await db().from('settings').insert({ key: CHAVE_DONO_DEPLOY, value: userId })
  } catch {
    
    
  }
}


export async function donoDoDeploy(): Promise<string | null> {
  const banco = db()
  const [reg, ws] = await Promise.all([
    banco.from('settings').select('value').eq('key', CHAVE_DONO_DEPLOY).maybeSingle(),
    banco
      .from('workspaces')
      .select('dono_id')
      .order('criado_em', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])
  return decidirDonoDoDeploy({
    registrado: (reg.data?.value as string | null) ?? null,
    donoDoWorkspaceMaisAntigo: (ws.data?.dono_id as string | null) ?? null,
  })
}


export async function ehDonoDoDeploy(): Promise<boolean> {
  const user = await usuarioAtual()
  if (!user) return false
  return ehODono(user.id, await donoDoDeploy())
}
