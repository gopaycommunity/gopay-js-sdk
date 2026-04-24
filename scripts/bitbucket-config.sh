# Docker login (if docker is available)
if command -v docker > /dev/null 2>&1; then
  if [ -z "$NEXUS_USERNAME" ] || [ -z "$NEXUS_PASSWORD" ]; then
    echo "Error: NEXUS_USERNAME and NEXUS_PASSWORD must be set for docker login" >&2
    exit 1
  fi
  echo "$NEXUS_PASSWORD" | docker login repo.gopay.com -u "$NEXUS_USERNAME" --password-stdin
fi
