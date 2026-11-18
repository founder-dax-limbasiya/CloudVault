FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY source/native-bundle/ /tmp/cloudvault-bundle/
RUN cat /tmp/cloudvault-bundle/part*.b64 | base64 -d | tar -xJ -C /app \
    && rm -rf /tmp/cloudvault-bundle \
    && npm install --omit=dev --no-audit --no-fund
EXPOSE 8787
CMD ["node", "server/index.js"]
