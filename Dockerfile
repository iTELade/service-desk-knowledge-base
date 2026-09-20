FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 KB_DATA_DIR=/data
COPY package.json ./
COPY server.mjs ./
COPY public ./public
COPY articles ./articles
RUN mkdir -p /data/uploads && chown -R node:node /data /app
VOLUME ["/data"]
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.mjs"]
