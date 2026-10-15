# Timeweb Cloud App Platform (framework "Dockerfile"): builds the site and serves it together with /api/leads.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY package.json ./
COPY scripts ./scripts
COPY server ./server
COPY src ./src
RUN node scripts/build.mjs --with-server
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]
