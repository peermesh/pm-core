FROM node@sha256:4d64b49e6c891c8fc821007cb1cdc6c0db7773110ac2c34bf2e6960adef62ed3

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

# Create media data directory structure with proper ownership for node user
RUN mkdir -p /data/media && chown -R node:node /data

USER node
EXPOSE 3000
CMD ["node", "server.js"]
