#!/bin/sh
set -e
# Pré-voo: 0 = normal, 2 = modo diagnóstico, 1 = não sobe (ver preflight.mjs).
# `set -e` mataria o script no exit != 0, então desarmamos só nesta chamada.
set +e
node preflight.mjs
PREFLIGHT=$?
set -e

if [ "$PREFLIGHT" = "1" ]; then
  exit 1   # EasyPanel mantém o container antigo servindo
fi

if [ "$PREFLIGHT" = "2" ]; then
  # Modo diagnóstico SÓ EXPLICA, nunca muta: não rodamos migrations. A prova de banco
  # virgem pode ter vindo do banco ERRADO — uma credencial apontando pro projeto de outra
  # pessoa —, e criar 13 migrations num banco alheio seria pior que o problema que estamos
  # mostrando.
  export AWAVE_MODO=diagnostico
  exec node server.js
fi

# Migrations pendentes ANTES do server (no-op sem DATABASE_URL). migrate.mjs é
# verbatim do Motor e continua sendo o ÚNICO dono do exit 1 por problema de banco.
node migrate.mjs

# Heartbeat: LIGADO por default (`:-1`). É o relógio interno do CRM — o que faz o produto
# trabalhar sem ninguém com a tela aberta:
#
#   · escoa o outbox de webhooks;
#   · roda as automações no horário marcado;
#   · drena a fila de envio dos canais e a do assistente;
#   · baixa a mídia que chega nas conversas e faz o expurgo diário.
#
# ⚠️ Este comentário explicava outra coisa até a licença comercial sair do produto: o default
# ligado existia porque o antigo kill-switch de licença trancava o CRM inteiro quando um
# install jovem passava 3 dias sem telefonar para casa, e era este heartbeat quem telefonava.
# Esse gate não existe mais — nada aqui fala com servidor de licença, e desligar o heartbeat
# não tranca mais ninguém. O default segue ligado pelas razões acima, que são as de sempre.
#
# Quem quiser desligar continua podendo: HEARTBEAT_ENABLED=0. O custo é o da lista acima —
# automação que não dispara, webhook que não sai, conversa que não drena.
if [ "${HEARTBEAT_ENABLED:-1}" = "1" ]; then
  export TICK_SECRET="${TICK_SECRET:-$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")}"
  node heartbeat-tick.mjs &
fi
exec node server.js
