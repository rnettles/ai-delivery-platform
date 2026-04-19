FROM node:20-alpine

WORKDIR /app

# Build context is platform/ — copy backend-api and governance separately
COPY backend-api/package*.json ./
RUN npm install && chmod +x node_modules/.bin/tsx

COPY backend-api/. .
COPY governance/. ./governance/

EXPOSE 3000

CMD ["npx", "tsx", "src/server.ts"]