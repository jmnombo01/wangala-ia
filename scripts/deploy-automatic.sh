#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_FILE="${1:-$ROOT_DIR/.env.deploy}"
REPO_NAME="${GITHUB_REPO_NAME:-wangala-ia}"
SERVICE_NAME="${RENDER_SERVICE_NAME:-wangala-ia-bf}"
RENDER_API="https://api.render.com/v1"
GITHUB_API="https://api.github.com"

log() { printf '\n\033[1;32m[Wangala]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[Erreur]\033[0m %s\n' "$*" >&2; exit 1; }

[[ -f "$SECRETS_FILE" ]] || fail "Fichier de secrets introuvable : $SECRETS_FILE"
chmod 600 "$SECRETS_FILE"
# shellcheck disable=SC1090
set -a; source "$SECRETS_FILE"; set +a

cleanup() {
  unset GITHUB_TOKEN RENDER_API_KEY GROQ_API_KEY
  if [[ -f "$SECRETS_FILE" ]]; then
    if command -v shred >/dev/null; then
      shred -u "$SECRETS_FILE" || rm -f "$SECRETS_FILE"
    else
      rm -f "$SECRETS_FILE"
    fi
  fi
  rm -f /tmp/wangala-git-askpass-$$ /tmp/wangala-render-create-$$.json /tmp/wangala-repo-$$.json
}
trap cleanup EXIT

for variable in GITHUB_TOKEN RENDER_API_KEY; do
  [[ -n "${!variable:-}" ]] || fail "$variable est absent du fichier de secrets."
done

DEMO_DEPLOYMENT=false
if [[ -z "${GROQ_API_KEY:-}" ]]; then
  DEMO_DEPLOYMENT=true
  export GROQ_API_KEY=""
  log "Aucune clé Groq : déploiement de l’infrastructure en attente du modèle IA"
fi

api_json() {
  local method="$1" url="$2" token="$3" body="${4:-}"
  if [[ -n "$body" ]]; then
    curl --fail-with-body --silent --show-error \
      --request "$method" --url "$url" \
      --header 'Accept: application/json' \
      --header 'Content-Type: application/json' \
      --header "Authorization: Bearer $token" \
      --data "$body"
  else
    curl --fail-with-body --silent --show-error \
      --request "$method" --url "$url" \
      --header 'Accept: application/json' \
      --header "Authorization: Bearer $token"
  fi
}

json_value() {
  local expression="$1"
  python -c "import json,sys; data=json.load(sys.stdin); print($expression)"
}

log "Vérification du compte GitHub"
GITHUB_USER_JSON="$(api_json GET "$GITHUB_API/user" "$GITHUB_TOKEN")"
GITHUB_LOGIN="$(printf '%s' "$GITHUB_USER_JSON" | json_value "data['login']")"
[[ -n "$GITHUB_LOGIN" ]] || fail "Impossible d’identifier le compte GitHub."
REPO_URL="https://github.com/$GITHUB_LOGIN/$REPO_NAME"

REPO_STATUS="$(curl --silent --output /tmp/wangala-repo-$$.json --write-out '%{http_code}' \
  --header 'Accept: application/vnd.github+json' \
  --header "Authorization: Bearer $GITHUB_TOKEN" \
  "$GITHUB_API/repos/$GITHUB_LOGIN/$REPO_NAME")"

if [[ "$REPO_STATUS" == "404" ]]; then
  log "Création du dépôt public $GITHUB_LOGIN/$REPO_NAME"
  CREATE_REPO_BODY="$(python - <<PY
import json
print(json.dumps({
  'name': '$REPO_NAME',
  'description': 'Wangala IA — agent intelligent francophone pensé au Burkina Faso',
  'private': False,
  'has_issues': True,
  'has_projects': False,
  'has_wiki': False,
  'auto_init': False
}))
PY
)"
  api_json POST "$GITHUB_API/user/repos" "$GITHUB_TOKEN" "$CREATE_REPO_BODY" >/dev/null
elif [[ "$REPO_STATUS" == "200" ]]; then
  log "Le dépôt $GITHUB_LOGIN/$REPO_NAME existe déjà ; mise à jour du code"
else
  cat /tmp/wangala-repo-$$.json >&2 || true
  fail "GitHub a renvoyé le statut $REPO_STATUS."
fi
rm -f /tmp/wangala-repo-$$.json

log "Envoi du code vers GitHub"
ASKPASS_FILE="/tmp/wangala-git-askpass-$$"
cat >"$ASKPASS_FILE" <<'ASKPASS'
#!/usr/bin/env sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "$GITHUB_TOKEN" ;;
  *) printf '\n' ;;
esac
ASKPASS
chmod 700 "$ASKPASS_FILE"
(
  cd "$ROOT_DIR"
  git remote remove origin 2>/dev/null || true
  git remote add origin "$REPO_URL.git"
  GIT_ASKPASS="$ASKPASS_FILE" GIT_TERMINAL_PROMPT=0 git push --set-upstream origin main
)
rm -f "$ASKPASS_FILE"

log "Vérification de l’espace de travail Render"
OWNERS_JSON="$(api_json GET "$RENDER_API/owners?limit=20" "$RENDER_API_KEY")"
OWNER_ID="$(printf '%s' "$OWNERS_JSON" | python -c "import json,sys; d=json.load(sys.stdin); x=d[0]; print((x.get('owner') or x).get('id',''))")"
[[ -n "$OWNER_ID" ]] || fail "Aucun espace de travail Render accessible."

SERVICES_JSON="$(api_json GET "$RENDER_API/services?ownerId=$OWNER_ID&limit=100" "$RENDER_API_KEY")"
EXISTING_SERVICE="$(printf '%s' "$SERVICES_JSON" | python -c "import json,sys; d=json.load(sys.stdin); items=[(x.get('service') or x) for x in d]; m=next((x for x in items if x.get('name')=='$SERVICE_NAME'),{}); print(json.dumps(m))")"
SERVICE_ID="$(printf '%s' "$EXISTING_SERVICE" | json_value "data.get('id','')")"
SERVICE_URL="$(printf '%s' "$EXISTING_SERVICE" | json_value "data.get('serviceDetails',{}).get('url') or data.get('url','')")"
DEPLOY_ID=""

if [[ -z "$SERVICE_ID" ]]; then
  log "Création du service Render Free $SERVICE_NAME"
  python - "$OWNER_ID" "$REPO_URL" "$SERVICE_NAME" > /tmp/wangala-render-create-$$.json <<'PY'
import json, os, sys
owner_id, repo_url, service_name = sys.argv[1:]
env_vars = [
  {"key": "LLM_API_URL", "value": "https://api.groq.com/openai/v1"},
  {"key": "LLM_MODEL", "value": "openai/gpt-oss-20b"},
  {"key": "LLM_FALLBACK_MODELS", "value": "openai/gpt-oss-120b,qwen/qwen3.6-27b"},
  {"key": "MAX_CONTEXT_CHARS", "value": "14000"},
  {"key": "MAX_OUTPUT_TOKENS", "value": "1200"},
  {"key": "PROVIDER_RETRIES", "value": "1"},
  {"key": "RATE_LIMIT_PER_MINUTE", "value": "30"}
]
if os.environ.get("GROQ_API_KEY"):
  env_vars.append({"key": "LLM_API_KEY", "value": os.environ["GROQ_API_KEY"]})
print(json.dumps({
  "type": "web_service",
  "name": service_name,
  "ownerId": owner_id,
  "repo": repo_url,
  "branch": "main",
  "autoDeploy": "yes",
  "envVars": env_vars,
  "serviceDetails": {
    "runtime": "docker",
    "plan": "free",
    "region": "frankfurt",
    "numInstances": 1,
    "healthCheckPath": "/api/health",
    "renderSubdomainPolicy": "enabled",
    "envSpecificDetails": {
      "dockerContext": ".",
      "dockerfilePath": "./Dockerfile.wangala"
    }
  }
}))
PY
  CREATE_RESPONSE="$(api_json POST "$RENDER_API/services" "$RENDER_API_KEY" "$(cat /tmp/wangala-render-create-$$.json)")"
  SERVICE_ID="$(printf '%s' "$CREATE_RESPONSE" | json_value "data['service']['id']")"
  SERVICE_URL="$(printf '%s' "$CREATE_RESPONSE" | json_value "data['service'].get('serviceDetails',{}).get('url') or data['service'].get('url','')")"
  DEPLOY_ID="$(printf '%s' "$CREATE_RESPONSE" | json_value "data.get('deployId','')")"
else
  log "Service Render existant détecté ; synchronisation des variables et redéploiement"
  ENV_BODY="$(python - <<'PY'
import json, os
items = [
  {"key": "LLM_API_URL", "value": "https://api.groq.com/openai/v1"},
  {"key": "LLM_MODEL", "value": "openai/gpt-oss-20b"},
  {"key": "LLM_FALLBACK_MODELS", "value": "openai/gpt-oss-120b,qwen/qwen3.6-27b"},
  {"key": "MAX_CONTEXT_CHARS", "value": "14000"},
  {"key": "MAX_OUTPUT_TOKENS", "value": "1200"},
  {"key": "PROVIDER_RETRIES", "value": "1"},
  {"key": "RATE_LIMIT_PER_MINUTE", "value": "30"}
]
if os.environ.get("GROQ_API_KEY"):
  items.append({"key": "LLM_API_KEY", "value": os.environ["GROQ_API_KEY"]})
print(json.dumps(items))
PY
)"
  api_json PUT "$RENDER_API/services/$SERVICE_ID/env-vars" "$RENDER_API_KEY" "$ENV_BODY" >/dev/null
  DEPLOY_RESPONSE="$(api_json POST "$RENDER_API/services/$SERVICE_ID/deploys" "$RENDER_API_KEY" '{"clearCache":"do_not_clear"}')"
  DEPLOY_ID="$(printf '%s' "$DEPLOY_RESPONSE" | json_value "data['id']")"
fi

[[ -n "$SERVICE_ID" ]] || fail "Le service Render n’a pas été créé."
[[ -n "$SERVICE_URL" ]] || SERVICE_URL="https://$SERVICE_NAME.onrender.com"

if [[ -n "$DEPLOY_ID" ]]; then
  log "Déploiement Render en cours — cette étape peut prendre plusieurs minutes"
  for attempt in $(seq 1 90); do
    DEPLOY_JSON="$(api_json GET "$RENDER_API/services/$SERVICE_ID/deploys/$DEPLOY_ID" "$RENDER_API_KEY")"
    STATUS="$(printf '%s' "$DEPLOY_JSON" | json_value "data.get('status','unknown')")"
    printf '\r[Wangala] État : %-24s (%s/90)' "$STATUS" "$attempt"
    case "$STATUS" in
      live) printf '\n'; break ;;
      build_failed|update_failed|pre_deploy_failed|canceled|deactivated)
        printf '\n'; fail "Le déploiement Render a échoué avec l’état : $STATUS" ;;
    esac
    sleep 10
  done
fi

log "Vérification de l’application"
for attempt in $(seq 1 18); do
  if HEALTH="$(curl --silent --fail --max-time 20 "$SERVICE_URL/api/health" 2>/dev/null)"; then
    MODEL_READY="$(printf '%s' "$HEALTH" | json_value "str(data.get('modelConfigured', False)).lower()")"
    if [[ "$DEMO_DEPLOYMENT" != "true" && "$MODEL_READY" != "true" ]]; then
      fail "L’application répond, mais le modèle n’est pas configuré."
    fi
    break
  fi
  sleep 10
done

printf '\n\033[1;32m===============================================\033[0m\n'
printf '\033[1;32m  Wangala IA est en ligne !\033[0m\n'
printf '\033[1;32m===============================================\033[0m\n'
printf 'GitHub : %s\n' "$REPO_URL"
printf 'Site   : %s\n' "$SERVICE_URL"
printf 'Santé  : %s/api/health\n' "$SERVICE_URL"
if [[ "$DEMO_DEPLOYMENT" == "true" ]]; then
  printf '\nAttention : ajoutez LLM_API_KEY dans Render pour activer les réponses Groq.\n'
fi
printf '\nLe fichier de secrets local a été supprimé automatiquement.\n'
