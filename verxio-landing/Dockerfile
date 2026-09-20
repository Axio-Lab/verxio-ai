FROM node:22-alpine AS build

WORKDIR /app
ENV npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false \
    NO_UPDATE_NOTIFIER=1

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .

ARG NEXT_PUBLIC_SITE_URL=https://www.verxio.xyz
ARG NEXT_PUBLIC_APP_URL=https://app.verxio.xyz
ARG NEXT_PUBLIC_AIML_TELEGRAM_URL=https://t.me/+XZYq5OzQXXQ2NDM0
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_AIML_TELEGRAM_URL=${NEXT_PUBLIC_AIML_TELEGRAM_URL}

RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=80 \
    npm_config_update_notifier=false \
    NO_UPDATE_NOTIFIER=1

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.mjs ./

EXPOSE 80
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "80"]
