import type { ClienteDb } from '@/server/db'
import { usuarioAtual, type Usuario } from '@/server/auth/sessao'


// `usuario` é injetável pelo mesmo motivo que `cliente` sempre foi: deixar o teste
// montar o cenário sem cookie. O padrão resolve pela sessão da requisição.
export async function resolverMembroAtivo(
  { cliente, ws, usuario }: { cliente: ClienteDb; ws: string; usuario?: Usuario | null },
): Promise<string | null> {
  const user = usuario !== undefined ? usuario : await usuarioAtual()
  if (!user) return null
  const { data, error } = await cliente
    .from('membros').select('id').eq('workspace_id', ws).eq('user_id', user.id).maybeSingle()
  if (error) throw error
  return (data as { id: string } | null)?.id ?? null
}
