FROM node:22-slim

COPY . /action
WORKDIR /action

RUN npm ci --omit=dev

ENTRYPOINT ["node", "/action/main.js"]
