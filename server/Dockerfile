FROM node:18-alpine

WORKDIR /app

# Copy package files for dependency caching
COPY package*.json ./
COPY public/package*.json ./public/

# Install server dependencies (production only)
RUN npm ci --omit=dev

# Install frontend dependencies (need devDeps for vite build)
WORKDIR /app/public
RUN npm ci

# Copy all source files
WORKDIR /app
COPY . .

# Build frontend for production
WORKDIR /app/public
RUN npm run build

# Clean up frontend source and devDeps after build (keep only the build output)
RUN rm -rf node_modules src .gitignore *.config.js

# Set working directory back to app root
WORKDIR /app

# Production environment
ENV NODE_ENV=production

# Expose the server port (internal, nginx-proxy reads VIRTUAL_PORT)
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

CMD ["node", "src/server.js"]
