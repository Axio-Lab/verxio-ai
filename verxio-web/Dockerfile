FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
# prepare installs local git hooks; not needed (or available) in the image build.
RUN npm ci --ignore-scripts

COPY . .

ARG VITE_VERXIO_API_ENABLED=true
ARG VITE_VERXIO_API_URL=
ARG VITE_BASE=/
ENV VITE_VERXIO_API_ENABLED=${VITE_VERXIO_API_ENABLED}
ENV VITE_VERXIO_API_URL=${VITE_VERXIO_API_URL}
ENV VITE_BASE=${VITE_BASE}

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
