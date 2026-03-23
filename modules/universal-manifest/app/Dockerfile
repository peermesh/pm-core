FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

USER node
EXPOSE 4200
CMD ["node", "server.js"]
