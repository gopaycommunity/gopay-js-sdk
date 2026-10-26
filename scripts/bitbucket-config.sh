# Docker login (if docker is available)
if command -v docker > /dev/null 2>&1; then
  if [ -z "$HARBOR_FE_USERNAME" ] || [ -z "$HARBOR_FE_PASSWORD" ]; then
    echo "Error: HARBOR_FE_USERNAME and HARBOR_FE_PASSWORD must be set for docker login" >&2
    exit 1
  fi
  echo "$HARBOR_FE_PASSWORD" | docker login registry.gopay.com -u "$HARBOR_FE_USERNAME" --password-stdin
fi
