# Build stage
FROM repo.gopay.com/base/node-24:1.0.0 AS builder

# SDK_VERSION is passed from the release pipeline step via --build-arg.
# The docker-build-push step clones the pre-release commit (before semantic-release
# commits the version bump), so sdk/package.json here still has the old version.
# Patching it before the build ensures the version string baked into the SDK bundle
# and the example page matches the actual release version.
ARG SDK_VERSION=dev
ARG BROWSER_SDK_VERSION=dev
ENV SDK_VERSION=$SDK_VERSION
ENV BROWSER_SDK_VERSION=$BROWSER_SDK_VERSION

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json yarn.lock .yarnrc.yml ./
COPY sdk/package.json sdk/
COPY browser-sdk/package.json browser-sdk/
COPY internal/core/package.json internal/core/
COPY example/package.json example/

RUN corepack enable && yarn install --immutable

# Copy source
COPY internal/core/ internal/core/
COPY sdk/ sdk/
COPY browser-sdk/ browser-sdk/
COPY example/ example/

RUN if [ "$SDK_VERSION" != "dev" ]; then npm pkg set version="$SDK_VERSION" --prefix sdk; fi
RUN if [ "$BROWSER_SDK_VERSION" != "dev" ]; then npm pkg set version="$BROWSER_SDK_VERSION" --prefix browser-sdk; fi

# Build SDK first (example workspace:* dep resolves via dist/)
RUN yarn workspace @gopaycz/gopay-js-sdk run build

ENV GP_BASE_PATH=/gp-gw-js-sdk/
RUN yarn workspace gopay-js-sdk-example run build

# Production stage
FROM repo.gopay.com/base/node-24:1.0.0

WORKDIR /app

ARG SDK_VERSION=dev
ENV NODE_ENV=production
ENV SDK_VERSION=$SDK_VERSION
# Baked into the Vite build — do not override at runtime.
ENV GP_BASE_PATH=/gp-gw-js-sdk/

COPY --from=builder /app/example/dist ./dist
COPY --from=builder /app/example/serve.js ./serve.js

EXPOSE 8080

CMD ["node", "serve.js"]
