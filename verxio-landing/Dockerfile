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
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html

EXPOSE 80
