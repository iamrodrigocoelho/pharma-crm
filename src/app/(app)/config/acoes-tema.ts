'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { db } from '@/server/db'
import { COOKIE_TEMA, normalizarTema } from '@/lib/tema'
import { usuarioAtual } from '@/server/auth/sessao'
import { atualizarMetadata } from '@/server/auth/usuarios'




export async function salvarTema(valor: string): Promise<{ ok: true } | { erro: 'tema_invalido' }> {
  const tema = normalizarTema(valor)
  if (!tema) return { erro: 'tema_invalido' }

  
  
  
  const jar = await cookies()
  jar.set(COOKIE_TEMA, tema, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })

  
  
  try {
    const user = await usuarioAtual()
    if (user) {
      // Mescla em vez de sobrescrever: o metadata guarda também o nome de exibição.
      await atualizarMetadata(user.id, { ...user.user_metadata, tema })
    }
  } catch {
    
    
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}
