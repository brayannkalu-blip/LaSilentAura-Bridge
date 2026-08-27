FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --force
COPY . .
ENV NODE_ENV=production
CMD ["npm", "start"]
