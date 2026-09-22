import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { db } from '@/server/db'
import { COOKIE_TEMA, resolverTema, type Tema } from '@/lib/tema'
import { usuarioAtual } from '@/server/auth/sessao'




export const metadataDoUsuario = cache(async (): Promise<Record<string, unknown> | null> => {
  try {
    return (await usuarioAtual())?.user_metadata ?? null
  } catch {
    return null
  }
})


export async function temaDaRequisicao(): Promise<Tema> {
  let sessao: unknown = null
  let cookie: unknown = null
  try {
    sessao = (await metadataDoUsuario())?.tema ?? null
  } catch {  }
  try {
    cookie = (await cookies()).get(COOKIE_TEMA)?.value ?? null
  } catch {  }
  return resolverTema({ sessao, cookie })
}
