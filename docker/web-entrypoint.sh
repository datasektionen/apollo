#!/bin/sh
set -eu

WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-8787}"
API_UPSTREAM_ORIGIN="${API_UPSTREAM_ORIGIN:-http://api:${API_PORT}}"
API_UPSTREAM_ORIGIN="${API_UPSTREAM_ORIGIN%/}"
USE_HTTPS="${VITE_USE_HTTPS:-false}"
CERT_PATH="/app/certs/dev.crt"
KEY_PATH="/app/certs/dev.key"

APK_DOWNLOAD_URL="${APOLLO_APK_DOWNLOAD_URL:-${APOLLO_APK_URL:-}}"

# One worker. `auto` forks one process per host CPU, which blows a small Nomad memory limit.
if [ -f /etc/nginx/nginx.conf ]; then
  sed -i 's/^worker_processes[[:space:]].*/worker_processes 1;/' /etc/nginx/nginx.conf
fi

write_common_config() {
  APK_CONFIG=""
  if [ -n "${APK_DOWNLOAD_URL}" ]; then
    APK_CONFIG="  location = /apollo.apk {
    return 302 ${APK_DOWNLOAD_URL};
  }"
  else
    APK_CONFIG="  location = /apollo.apk {
    default_type application/vnd.android.package-archive;
    add_header Content-Type application/vnd.android.package-archive;
    add_header Content-Disposition \"attachment; filename=\\\"apollo.apk\\\"\";
    add_header Cache-Control \"no-cache, must-revalidate\";
  }"
  fi

  cat <<EOF
  root /usr/share/nginx/html;
  index index.html;
  client_max_body_size 500m;

  include /etc/nginx/mime.types;
  types {
    audio/wav wav;
    application/manifest+json webmanifest;
    application/vnd.android.package-archive apk;
  }

${APK_CONFIG}

  location = /sw.js {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    add_header Pragma "no-cache";
    add_header Expires "0";
    add_header Service-Worker-Allowed "/";
  }

  location = /index.html {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    add_header Pragma "no-cache";
    add_header Expires "0";
  }

  location = /keepalive.wav {
    default_type audio/wav;
    add_header Content-Type audio/wav;
    add_header Accept-Ranges bytes;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
  }

  location = /manifest.webmanifest {
    default_type application/manifest+json;
    add_header Content-Type application/manifest+json;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
  }

  location / {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    try_files \$uri \$uri/ /index.html;
  }

  location /api/media/ {
    proxy_pass ${API_UPSTREAM_ORIGIN}/api/media/;
    proxy_http_version 1.1;
    # Stream audio. Buffering the whole file into proxy temp charges the
    # container memory limit and gets the worker killed mid-response.
    proxy_buffering off;
    proxy_request_buffering off;
    gzip off;
    proxy_set_header Host \$http_host;
    proxy_set_header X-Forwarded-Host \$http_host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /api/ {
    proxy_pass ${API_UPSTREAM_ORIGIN}/api/;
    proxy_http_version 1.1;
    proxy_set_header Host \$http_host;
    proxy_set_header X-Forwarded-Host \$http_host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /ws {
    proxy_pass ${API_UPSTREAM_ORIGIN}/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$http_host;
    proxy_set_header X-Forwarded-Host \$http_host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
EOF
}

if [ "${USE_HTTPS}" = "true" ]; then
  if [ ! -f "${CERT_PATH}" ] || [ ! -f "${KEY_PATH}" ]; then
    echo "HTTPS requested but cert files were not found. Expected key at \"${KEY_PATH}\" and cert at \"${CERT_PATH}\"." >&2
    exit 1
  fi

  cat > /etc/nginx/conf.d/default.conf <<EOF
server {
  listen ${WEB_PORT} ssl;
  listen [::]:${WEB_PORT} ssl;
  server_name _;
  ssl_certificate ${CERT_PATH};
  ssl_certificate_key ${KEY_PATH};
  ssl_protocols TLSv1.2 TLSv1.3;
$(write_common_config)
}
EOF
else
  cat > /etc/nginx/conf.d/default.conf <<EOF
server {
  listen ${WEB_PORT};
  listen [::]:${WEB_PORT};
  server_name _;
$(write_common_config)
}
EOF
fi

exec nginx -g 'daemon off;'
