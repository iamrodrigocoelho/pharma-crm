import { usuarioAtual } from '@/server/auth/sessao'
import { resolverWorkspaceAtivo } from '@/server/auth/workspace-ativo'
import { inscreverNoInbox } from '@/server/canais/eventos-inbox'

// SSE do inbox: substitui o socket do Realtime do Supabase.
//
// O workspace NÃO vem do cliente. Ele é resolvido aqui, a partir da sessão — se
// viesse por query string, qualquer pessoa logada escutaria o inbox de outro
// workspace só trocando o parâmetro.

export const dynamic = 'force-dynamic'

// Sem isto, um proxy com buffer (nginx no padrão) segura os eventos e o "ao vivo"
// chega em blocos de vários minutos.
const CABECALHOS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
}

const PULSO_MS = 25_000

export async function GET(req: Request): Promise<Response> {
  const user = await usuarioAtual()
  if (!user) return new Response('sem sessao', { status: 401 })

  const ws = await resolverWorkspaceAtivo()
  if (!ws) return new Response('sem workspace', { status: 403 })

  const codificador = new TextEncoder()
  let desinscrever: (() => void) | null = null
  let pulso: ReturnType<typeof setInterval> | null = null

  const corpo = new ReadableStream({
    async start(controle) {
      const enviar = (texto: string) => {
        try {
          controle.enqueue(codificador.encode(texto))
        } catch {
          // Fluxo já fechado pelo cliente; o abort abaixo faz a limpeza.
        }
      }

      // Evento inicial: o cliente só considera a conexão viva depois de receber algo,
      // e sem ele uma conexão que nunca recebe mudança ficaria indistinguível de uma
      // conexão quebrada.
      enviar(': conectado\n\n')

      try {
        desinscrever = await inscreverNoInbox(ws, () => enviar('event: mudanca\ndata: 1\n\n'))
      } catch {
        enviar('event: erro\ndata: escuta indisponivel\n\n')
        controle.close()
        return
      }

      // Comentário periódico: mantém a conexão de pé atravessando proxies que
      // derrubam conexão ociosa, e faz o cliente perceber a queda quando ela ocorre.
      pulso = setInterval(() => enviar(': pulso\n\n'), PULSO_MS)
    },
    cancel() {
      desinscrever?.()
      if (pulso) clearInterval(pulso)
    },
  })

  req.signal.addEventListener('abort', () => {
    desinscrever?.()
    if (pulso) clearInterval(pulso)
  })

  return new Response(corpo, { headers: CABECALHOS })
}
