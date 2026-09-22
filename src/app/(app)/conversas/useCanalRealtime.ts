'use client'

import { useEffect, useRef, useState } from 'react'
import { PULSO, type DesfechoDaLeitura } from '@/lib/canais/conexao-inbox'
import { criarSupervisor } from '@/lib/canais/supervisor-inbox'

// Inbox ao vivo. Antes: socket do Realtime do Supabase, assinando `postgres_changes`
// em `mensagens` e `conversas` com filtro por workspace. Agora: SSE em
// /api/interno/inbox-eventos, alimentado por `pg_notify` (migration 0062).
//
// O que mudou de verdade para quem escreve este código: o workspace NÃO viaja mais
// do cliente. Antes o filtro `workspace_id=eq.<id>` ia do navegador para o Realtime,
// e era a RLS que impedia alguém de escutar workspace alheio. Sem RLS, quem decide é
// a rota — ela resolve o workspace pela sessão e ignora qualquer coisa que o cliente
// mande. O `workspaceId` daqui só serve para reassinar quando o usuário troca de
// workspace na mesma aba.
//
// O supervisor (`criarSupervisor`) não mudou: ele continua sendo o dono da
// reconexão, do aviso na tela e da reconciliação por leitura. Este arquivo só troca
// o transporte, e por isso continua falando os mesmos status que ele entende.

const ROTA = '/api/interno/inbox-eventos'

export type Assinatura = { desassinar: () => void }

export function assinar({ onChange, aoStatus }: {
  onChange: () => void
  aoStatus?: (status: string, desassinar: () => void) => void
}): Assinatura {
  const fonte = new EventSource(ROTA)

  let fechado = false
  const assinatura: Assinatura = {
    desassinar: () => {
      fechado = true
      try {
        fonte.close()
      } catch {
        // Já fechada; nada a fazer.
      }
    },
  }

  fonte.onopen = () => {
    if (!fechado) aoStatus?.('SUBSCRIBED', assinatura.desassinar)
  }

  fonte.addEventListener('mudanca', () => {
    if (!fechado) onChange()
  })

  fonte.addEventListener('erro', () => {
    if (fechado) return
    aoStatus?.('CHANNEL_ERROR', assinatura.desassinar)
  })

  // 🔴 FECHAR NO ERRO É DE PROPÓSITO. O `EventSource` reconecta sozinho, e essa
  // reconexão automática competiria com a do supervisor — duas conexões vivas, a
  // contagem de tentativas dele mentindo, e o aviso de "sem conexão" nunca
  // aparecendo. Aqui o transporte só reporta a queda; quem decide reconectar é ele.
  fonte.onerror = () => {
    if (fechado) return
    assinatura.desassinar()
    fechado = false // permite que o supervisor assine de novo com uma fonte nova
    aoStatus?.('CHANNEL_ERROR', assinatura.desassinar)
  }

  return assinatura
}

export function useCanalRealtime({
  workspaceId,
  reconciliar,
}: {
  workspaceId: string
  reconciliar: () => Promise<DesfechoDaLeitura>
}): { aviso: string | null } {
  const [aviso, setAviso] = useState<string | null>(null)
  const reconciliarRef = useRef(reconciliar)
  useEffect(() => {
    reconciliarRef.current = reconciliar
  }, [reconciliar])

  useEffect(() => {
    const supervisor = criarSupervisor({
      assinar: ({ onChange, aoStatus }) => assinar({ onChange, aoStatus }),
      agendar: (fn, ms) => {
        const t = setTimeout(fn, ms)
        return () => clearTimeout(t)
      },
      agora: () => Date.now(),
      estaVisivel: () => document.visibilityState !== 'hidden',
      reconciliar: () => reconciliarRef.current(),
      aoAviso: setAviso,
    })

    const relogio = setInterval(() => supervisor.pulsar(), PULSO)
    const aoVoltar = () => supervisor.aoVoltarAOlhar()
    document.addEventListener('visibilitychange', aoVoltar)

    return () => {
      clearInterval(relogio)
      document.removeEventListener('visibilitychange', aoVoltar)
      supervisor.parar()
    }
  }, [workspaceId])

  return { aviso }
}
