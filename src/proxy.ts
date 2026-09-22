import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_SESSAO, abrirToken } from '@/server/auth/token-sessao'




const ROTAS_PUBLICAS = ['/entrar', '/cadastrar', '/convite']

function ehPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}


export function deveRedirecionar(pathname: string, temSessao: boolean): boolean {
  if (temSessao) return false
  if (pathname.startsWith('/api')) return false
  if (ehPublica(pathname)) return false
  return true
}


export function deveDiagnosticar(pathname: string, emDiagnostico: boolean): boolean {
  if (!emDiagnostico) return false
  if (pathname.startsWith('/api')) return false
  if (pathname === '/diagnostico') return false
  return true
}


export function ehIngressPublico(pathname: string): boolean {
  return /^\/api\/canais\/[^/]+\/webhook(\/|$)/.test(pathname)
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  
  
  
  
  if ((process.env.PHARMA_MODO ?? process.env.AWAVE_MODO) === 'diagnostico') {
    if (deveDiagnosticar(request.nextUrl.pathname, true)) {
      const destino = request.nextUrl.clone()
      destino.pathname = '/diagnostico'
      return NextResponse.rewrite(destino)
    }
    
    return NextResponse.next({ request })
  }

  
  
  if (ehIngressPublico(request.nextUrl.pathname)) return NextResponse.next({ request })

  // 🔴 ESTE MIDDLEWARE NÃO AUTORIZA NADA. Ele só decide o redirecionamento barato
  // para /entrar, e para isso confere a ASSINATURA e a VALIDADE do cookie — nunca o
  // banco. O motivo é o runtime: middleware do Next roda no edge, onde não há
  // conexão com o Postgres, e o antigo `supabase.auth.getUser()` só funcionava aqui
  // porque falava HTTP com o GoTrue.
  //
  // Quem de fato autoriza é o servidor, em `exigirSessao()`: lá a linha da sessão é
  // conferida na tabela, o que faz logout e revogação valerem na hora. Um cookie
  // assinado mas com a sessão já encerrada passa por aqui e é barrado lá — de
  // propósito, porque o custo de errar para o lado permissivo AQUI é zero.
  const token = request.cookies.get(COOKIE_SESSAO)?.value
  const sessao = await abrirToken(token).catch(() => null)

  if (deveRedirecionar(request.nextUrl.pathname, Boolean(sessao))) {
    const destino = request.nextUrl.clone()
    destino.pathname = '/entrar'
    return NextResponse.redirect(destino)
  }

  return NextResponse.next({ request })
}

export const config = {
  matcher: [
    
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
