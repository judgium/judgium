#!/usr/bin/env bash
#
# Provisions Judgium on Azure App Service (Linux, built-in Node runtime).
#
#   ./deploy/provision-azure.sh my-resource-group judgium-demo japaneast \
#       https://github.com/judgium/judgium
#
# Idempotent: re-running updates the existing app's settings.
set -euo pipefail

RESOURCE_GROUP="${1:-judgium-rg}"
APP_NAME="${2:-judgium-$RANDOM}"
LOCATION="${3:-japaneast}"
PLAN_NAME="${APP_NAME}-plan"
# B1 is the smallest tier with Always On, which an SSE app needs so the
# container is not unloaded between demos. P0v3/P1v3 for larger events.
# AGPL-3.0 section 13: every user who interacts with this deployment over a
# network must be able to get the source of the version it is running. The
# page footer links to /source, which redirects here. Point it at the
# repository the deployed code came from -- and note that a PRIVATE repository
# does not satisfy section 13 for a publicly reachable instance.
SOURCE_URL="${4:-${SOURCE_URL:-https://github.com/judgium/judgium}}"

SKU="${SKU:-B1}"
NODE_VERSION="${NODE_VERSION:-NODE|22-lts}"

command -v az >/dev/null || { echo "Azure CLI (az) is required" >&2; exit 1; }

echo "==> Resource group ${RESOURCE_GROUP} (${LOCATION})"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

echo "==> App Service plan ${PLAN_NAME} (${SKU}, Linux)"
az appservice plan create \
  --name "$PLAN_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku "$SKU" \
  --is-linux \
  --output none

echo "==> Web app ${APP_NAME} (${NODE_VERSION})"
az webapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$PLAN_NAME" \
  --runtime "$NODE_VERSION" \
  --output none

SESSION_SECRET="$(node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))' 2>/dev/null \
  || openssl rand -hex 48)"
HOST="$(az webapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query defaultHostName -o tsv)"

echo "==> Application settings"
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    NODE_ENV=production \
    SESSION_SECRET="$SESSION_SECRET" \
    PUBLIC_BASE_URL="https://${HOST}" \
    SOURCE_URL="$SOURCE_URL" \
    DATABASE_PATH=/home/data/judgium.db \
    SCM_DO_BUILD_DURING_DEPLOYMENT=true \
    WEBSITE_NODE_DEFAULT_VERSION=~22 \
  --output none

echo "==> Runtime configuration"
# /home is the persistent share; the SQLite file must live there so it
# survives restarts, scale operations and deployments.
az webapp config set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --startup-file "node server.js" \
  --always-on true \
  --http20-enabled true \
  --min-tls-version 1.2 \
  --output none

# Health check restarts an unhealthy instance instead of serving 5xx mid-event.
az webapp config set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --generic-configurations '{"healthCheckPath": "/healthz"}' \
  --output none

# Live updates (SSE) are held per instance. Session affinity keeps a viewer
# pinned to the instance streaming to them if the plan is ever scaled out.
az webapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --client-affinity-enabled true \
  --https-only true \
  --output none

cat <<EOF

Provisioned.

  App           https://${HOST}
  Health        https://${HOST}/healthz
  Database      /home/data/judgium.db  (persistent share)
  Source link   ${SOURCE_URL}  (AGPL-3.0 section 13)

Deploy the code with either:

  az webapp up --name ${APP_NAME} --resource-group ${RESOURCE_GROUP}

or a zip deploy from a Linux build:

  npm ci --omit=dev
  zip -r deploy.zip . -x '.git/*' 'data/*' 'test/*' '*.db*'
  az webapp deploy --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} \\
    --src-path deploy.zip --type zip

Then create the first organizer account at https://${HOST}/signup and set
DISABLE_SIGNUP=1 afterwards if you want to close registration:

  az webapp config appsettings set --name ${APP_NAME} \\
    --resource-group ${RESOURCE_GROUP} --settings DISABLE_SIGNUP=1
EOF
