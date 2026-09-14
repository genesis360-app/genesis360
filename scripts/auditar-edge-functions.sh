#!/usr/bin/env bash
# Auditoría de drift de Edge Functions: el código DESPLEGADO en DEV y PROD contra HEAD del repo.
#
#   bash scripts/auditar-edge-functions.sh [funcion ...]      # sin argumentos: todas
#
# Por qué existe (2026-09-14): mergear `dev`→`main` despliega el frontend (Vercel) pero NO las Edge
# Functions — esas se despliegan a mano. El wiki decía que el lock anti doble-emisión de
# `emitir-factura` (mig 361) estaba "EN PROD desde 2026-08-20", y la EF de PROD seguía siendo la
# del 15/07: la migración había ido, la función no. Esta auditoría encontró además `tn-webhook` y
# `meli-webhook` sin la reserva atómica de stock en DEV **y** PROD, y `scan-ticket` sin desplegar en
# PROD aunque el frontend la llama.
#
# Correrla en cada deploy a PROD, y antes de escribir "EN PROD" sobre cualquier cambio de una EF.
#
# Salida: una línea por función y ambiente → `<funcion> <ambiente> <líneas distintas>` (0 = idéntico),
# con el detalle por archivo. `NO_DESPLEGADA` = no existe en ese proyecto; `NO_EN_REPO` = el proyecto
# tiene un archivo que el repo no.
#
# ⚠️ Al redesplegar respetar `verify_jwt`: los webhooks (tn-webhook, meli-webhook, wa-webhook,
# modo-*, mp-webhook, mp-ipn…) van con `--no-verify-jwt`. Ver `list_edge_functions` antes.
#
# Requiere la CLI de Supabase logueada (`npx supabase`). Usa `--use-api`: no necesita Docker.

set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
AMBIENTES="prod:jjffnbrdjchquexdfgwq dev:gcmhzdedrkmmzfzfveig"

cd "$REPO"
if [ "$#" -gt 0 ]; then
  FUNCIONES="$*"
else
  FUNCIONES=$(for d in supabase/functions/*/; do n=$(basename "$d"); [ "$n" != "_shared" ] && echo "$n"; done)
fi

for fn in $FUNCIONES; do
  for env in $AMBIENTES; do
    nombre=${env%%:*}; ref=${env##*:}
    dst="$OUT/$nombre/$fn"
    mkdir -p "$dst"
    if ! (cd "$dst" && npx supabase functions download "$fn" --project-ref "$ref" --use-api >/dev/null 2>&1); then
      echo "$fn $nombre NO_DESPLEGADA"
      continue
    fi
    total=0; detalle=""
    base="$dst/supabase/functions"
    while IFS= read -r archivo; do
      rel=${archivo#"$base/"}
      if ! git show "HEAD:supabase/functions/$rel" > "$OUT/head.tmp" 2>/dev/null; then
        detalle="$detalle $rel=NO_EN_REPO"; continue
      fi
      c=$(diff --strip-trailing-cr "$archivo" "$OUT/head.tmp" | grep -c '^[<>]')
      total=$((total + c))
      [ "$c" != "0" ] && detalle="$detalle $rel=$c"
    done < <(find "$base" -type f)
    echo "$fn $nombre $total$detalle"
  done
done
git checkout -- supabase/.temp/cli-latest 2>/dev/null || true
