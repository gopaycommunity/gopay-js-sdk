# Docker login (if docker is available)
if command -v docker > /dev/null 2>&1; then
  echo "$NEXUS_PASSWORD" | docker login repo.gopay.com -u $NEXUS_USERNAME --password-stdin
fi
