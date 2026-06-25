# Use specific version — never use 'latest' in production
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first — Docker layer caching
# If package.json hasn't changed, npm install layer is reused
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Generate Prisma client inside the container
COPY src/prisma ./src/prisma
RUN npx prisma generate --schema=src/prisma/schema.prisma

# Copy rest of source
COPY src ./src

# Non-root user — security best practice
# Never run containers as root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Expose API port
EXPOSE 3000

# Default command — override in docker-compose for worker
CMD ["node", "src/server.js"]