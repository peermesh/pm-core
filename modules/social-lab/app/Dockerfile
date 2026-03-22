FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

# Create media data directory structure with proper ownership for node user
RUN mkdir -p /data/media && chown -R node:node /data

USER node
EXPOSE 3000
CMD ["node", "server.js"]
