FROM node:18-alpine
WORKDIR /app

COPY FINAL-CODE/AWS/package.json FINAL-CODE/AWS/package-lock.json* ./FINAL-CODE/AWS/
RUN npm --prefix FINAL-CODE/AWS ci --omit=dev

COPY FINAL-CODE/AWS ./FINAL-CODE/AWS
WORKDIR /app/FINAL-CODE/AWS

EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
