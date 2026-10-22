FROM node:22.23.4-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

WORKDIR /app

ENV WEB_PORT=3000
ENV API_PORT=8787
ENV API_UPSTREAM_ORIGIN=
ENV VITE_USE_HTTPS=false

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/web-entrypoint.sh /usr/local/bin/web-entrypoint.sh
RUN chmod +x /usr/local/bin/web-entrypoint.sh

CMD ["web-entrypoint.sh"]
