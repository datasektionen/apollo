# Build context must be the repository root (not ./server) so that the
# shared/ access-rules module used by both frontend and backend is available:
#   docker build -f server/Dockerfile .
FROM node:22.23.4-alpine

WORKDIR /app/server

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

COPY shared /app/shared
COPY server/src ./src
CMD ["npm", "start"]
