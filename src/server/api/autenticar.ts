import { verificarAssinatura } from '@platform/server/custom/verificarAssinatura'
import type { AuthDescriptor } from '@platform/server/custom/contrato'



export const CABECALHO_ASSINATURA = 'x-pharma-signature'

// 🔴 O NOME ANTIGO CONTINUA ACEITO NA ENTRADA, E ISSO NÃO É ZELO EXCESSIVO. Este
// cabeçalho é contrato com sistemas de FORA: quem já integrou assina com
// `x-awave-signature`, e recusar esse nome derrubaria integrações em produção sem
// que ninguém aqui ficasse sabendo — o erro apareceria do lado do integrador, como
// 401 silencioso. Aceitar os dois custa uma tentativa a mais e não enfraquece nada:
// a assinatura conferida é a mesma, com o mesmo segredo.
const CABECALHO_LEGADO = 'x-awave-signature'

function descritor(header: string): AuthDescriptor {
  return { tipo: 'hmac', em: 'header', header, encoding: 'hex', segredo: '(injetado-por-rota)' }
}

export function autenticarEntrada(e: { raw: string; headers: Record<string, string>; valorSegredo: string | null }): boolean {
  const tentar = (header: string) =>
    verificarAssinatura({
      raw: e.raw,
      headers: e.headers,
      query: {},
      descriptor: descritor(header),
      valorSegredo: e.valorSegredo,
    })
  if (e.headers[CABECALHO_ASSINATURA] !== undefined) return tentar(CABECALHO_ASSINATURA)
  return tentar(CABECALHO_LEGADO)
}
