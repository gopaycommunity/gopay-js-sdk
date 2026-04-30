# Build stage
FROM repo.gopay.com/base/node-24:1.0.0 AS builder

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json yarn.lock .yarnrc.yml ./
COPY sdk/package.json sdk/
COPY example/package.json example/

RUN corepack enable && yarn install --immutable

# Copy source
COPY sdk/ sdk/
COPY example/ example/

# Build SDK first (example workspace:* dep resolves via dist/)
RUN yarn workspace gopay-js-sdk run build

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
