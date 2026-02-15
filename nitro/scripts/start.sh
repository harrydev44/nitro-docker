#!/bin/bash
set -e

SOCKET_URL="${SOCKET_URL:-ws://127.0.0.1:2096}"
CONFIG="/usr/share/nginx/html/renderer-config.json"

# Start from the template config (copied at build time)
# Replace socket URL (dynamic, from env var)
sed -i "s|\"socket.url\":.*|\"socket.url\": \"${SOCKET_URL}\",|" "$CONFIG"

# Replace asset URLs from localhost to relative paths (served by same nginx)
sed -i 's|"asset.url":.*|"asset.url": "/game-assets",|' "$CONFIG"
sed -i 's|"image.library.url":.*|"image.library.url": "/swf/c_images/",|' "$CONFIG"
sed -i 's|"hof.furni.url":.*|"hof.furni.url": "/swf/dcr/hof_furni",|' "$CONFIG"

echo "[START] renderer-config.json updated (socket: ${SOCKET_URL})"

# Start nginx in foreground
exec nginx -g 'daemon off;'
