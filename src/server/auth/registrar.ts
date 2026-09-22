import 'server-only'
import { db } from '@/server/db'
import { reivindicarDonoDoDeploy } from '@/server/auth/dono-deploy'
import { conviteEhValido } from '@/server/auth/convites'
import { criarUsuario, excluirUsuario } from '@/server/auth/usuarios'




type Resultado = { ok: true; workspaceId: string | null } | { erro: string }

export async function registrar({ email, senha, nomeWorkspace, convite }: {
  email: string
  senha: string
  nomeWorkspace: string
  convite?: string
}): Promise<Resultado> {
  const banco = db()

  
  
  
  
  
  
  
  const comConvite = convite ? await conviteEhValido(convite) : false
  if (convite && !comConvite) return { erro: 'convite_invalido' }

  
  
  
  
  
  
  
  let ehBootstrap = false
  if (!comConvite) {
    const { data: claim, error: eClaim } = await banco
      .from('settings')
      .update({ value: 'true' })
      .eq('key', 'bootstrap_feito')
      .eq('value', 'false')
      .select('key')
    if (eClaim) return { erro: 'falha_bootstrap' } 
    ehBootstrap = (claim?.length ?? 0) > 0
  }

  if (!ehBootstrap && !comConvite) {
    const { data: s } = await banco
      .from('settings')
      .select('value')
      .eq('key', 'signup_aberto')
      .maybeSingle()
    if ((s as { value?: string } | null)?.value !== 'true') return { erro: 'cadastro_fechado' }
  }

  
  // Sem GoTrue: o usuário nasce aqui, com a senha em scrypt. Não há confirmação de
  // e-mail (o `email_confirm: true` de antes já a dispensava — instalação self-host
  // não tem remetente configurado).
  const criacao = await criarUsuario({ email, senha })
  if ('erro' in criacao) {
    
    if (ehBootstrap) await banco.from('settings').update({ value: 'false' }).eq('key', 'bootstrap_feito')
    // O GoTrue devolvia um erro só para tudo; agora dá para separar o caso comum.
    return { erro: criacao.erro === 'email_em_uso' ? 'email_em_uso' : 'falha_criar_usuario' }
  }
  const u = criacao.usuario

  
  
  
  
  
  
  if (comConvite) return { ok: true, workspaceId: null }

  const { data: wsId, error: e2 } = await banco.rpc('criar_workspace', {
    nome: nomeWorkspace,
    p_dono: u.id,
  })
  if (e2 || !wsId) {
    
    
    
    
    
    
    if (ehBootstrap) {
      await excluirUsuario(u.id).catch(() => {})
      await banco.from('settings').update({ value: 'false' }).eq('key', 'bootstrap_feito')
    }
    return { erro: 'falha_criar_workspace' }
  }

  
  
  
  
  
  
  
  
  if (ehBootstrap) await reivindicarDonoDoDeploy(u.id)

  return { ok: true, workspaceId: wsId as string }
}
