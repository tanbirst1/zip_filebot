FROM mcr.microsoft.com/playwright:focal

# Install Node.js (latest LTS)
RUN apt-get update && apt-get install -y curl \
    && curl -fsSL https://deb.nodesource.com/setup_lts.x | bash \
    && apt-get install -y nodejs \
    && npm install -g npm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy all project files
COPY . .

# Expose port
EXPOSE 10000

# Start command
CMD ["node", "server.js"]
