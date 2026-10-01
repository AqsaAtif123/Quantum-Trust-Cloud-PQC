FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist

# Never run as root inside the container.
RUN useradd --uid 10001 --shell /usr/sbin/nologin --no-create-home qtapp
USER qtapp

EXPOSE 4000
CMD ["node", "dist/server.js"]
