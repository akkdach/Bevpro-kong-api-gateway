# Use Node.js 20 alpine for a small image size
FROM node:20-alpine

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3005

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install dependencies for production
# Using 'npm ci' ensures we get the exact versions in package-lock.json
RUN npm ci --only=production

# Copy the rest of the application code
COPY . .

# Expose the API port
EXPOSE 3005

# Run the app
CMD ["npm", "start"]
