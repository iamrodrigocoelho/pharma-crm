import 'server-only'
import manifesto from './pharma-manifest.json'

// A versão que o rodapé de Configurações mostra.
//
// Havia aqui também um `licenciadoPara()`, que lia `awave-stamp.json` — o carimbo
// de licença comercial, com nome, e-mail e id de licença do comprador. O carimbo
// saiu do projeto junto com o sistema de licenciamento; o que sobra é a versão,
// que vem do manifesto e não identifica ninguém.

export function refDaRelease(): string | null {
  const ref = (manifesto as { ref?: unknown }).ref
  return typeof ref === 'string' && ref !== '' ? ref : null
}

export function versaoParaExibir(): string {
  return refDaRelease() ?? 'desenvolvimento'
}
