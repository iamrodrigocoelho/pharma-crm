import 'server-only'
import { cache } from 'react'
import { db } from '@/server/db'
import { resolverWorkspaceAtivo } from '@/server/auth/workspace-ativo'
import { resolverMembroAtivo } from '@/server/auth/membro-ativo'
import { nomeExibicao, rotuloSemNome } from '@/lib/nome-exibicao'
import { buscarUsuariosPorIds } from '@/server/auth/usuarios'



export type Pessoa = {
  
  id: string
  nome: string
  papel: 'owner' | 'membro'
}


async function carregar(): Promise<Pessoa[]> {
  const cliente = db()
  const ws = await resolverWorkspaceAtivo({ cliente })
  if (!ws) return []

  
  const { data, error } = await cliente
    .from('membros')
    .select('id, user_id, papel')
    .eq('workspace_id', ws)
    .order('criado_em', { ascending: true })
  if (error) throw error

  const linhas = (data as Array<{ id: string; user_id: string; papel: 'owner' | 'membro' }> | null) ?? []
  if (linhas.length === 0) return []

  // Uma consulta para a lista inteira; antes era uma chamada por membro.
  // Usuário ausente continua caindo no rótulo sem nome, como no `catch` anterior.
  const usuarios = await buscarUsuariosPorIds(linhas.map((m) => m.user_id))
  return linhas.map((m) => {
    const u = usuarios.get(m.user_id)
    return {
      id: m.id,
      nome: nomeExibicao(u?.user_metadata, u?.email, rotuloSemNome(m.id)),
      papel: m.papel,
    }
  })
}


export const listarPessoas = cache(carregar)


export const membroAtivo = cache(async (): Promise<string | null> => {
  const cliente = db()
  const ws = await resolverWorkspaceAtivo({ cliente })
  if (!ws) return null
  return resolverMembroAtivo({ cliente, ws })
})


export function nomeDaPessoa(pessoas: Pessoa[], id: string | null | undefined): string | null {
  if (!id) return null
  return pessoas.find((p) => p.id === id)?.nome ?? null
}
