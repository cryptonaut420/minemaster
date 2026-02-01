FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY public/package*.json ./public/

# Install server dependencies
RUN npm install

# Install frontend dependencies
WORKDIR /app/public
RUN npm install

# Copy source files
WORKDIR /app
COPY . .

# Build frontend for production
WORKDIR /app/public
RUN npm run build

# Set working directory back to app root
WORKDIR /app

# Expose port
EXPOSE 3001

# Start server
CMD ["npm", "start"]
