





import 'server-only'
import { db } from '@/server/db'
import { normalizarConfig, type ConfigHorario } from '@/lib/agente/horario-atendimento'


export async function lerHorarioDeAtendimento(ws: string): Promise<ConfigHorario | null> {
  try {
    const { data, error } = await db()
      .from('horario_atendimento')
      .select('fuso, faixas, feriados')
      .eq('workspace_id', ws)
      .maybeSingle()
    if (error || !data) return null
    return normalizarConfig(data)
  } catch {
    return null
  }
}
