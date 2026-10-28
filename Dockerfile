# Logbook server + app in one container. The app is served by the same server,
# so there is a single address and no cross-origin setup.
# Mount a persistent volume at /data: it holds the database (all accounts and entries).
FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY index.html app.js core.js config.js api.js ui.js supervisor.js style.css sw.js manifest.webmanifest icon-192.png icon-512.png ./
ENV NODE_ENV=production PORT=8080 LOGBOOK_DB=/data/logbook.db
VOLUME /data
EXPOSE 8080
CMD ["node", "--no-warnings=ExperimentalWarning", "server/index.js"]
