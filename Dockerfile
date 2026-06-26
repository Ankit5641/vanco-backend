FROM node:20-alpine

# Install build dependencies including OpenSSL for Prisma
RUN apk add --no-cache python3 make g++ vips-dev openssl openssl-dev libc6-compat

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY src/prisma ./src/prisma

RUN npx prisma generate --schema=src/prisma/schema.prisma

COPY src ./src

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

CMD ["node", "src/server.js"]