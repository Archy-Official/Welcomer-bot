FROM node:22-alpine
WORKDIR /app

# Install native compilation build chains and font rendering dependencies for skia-canvas on Alpine
RUN apk add --no-cache python3 make g++ fontconfig ttf-dejavu freetype freetype-dev fribidi

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 7860
ENV PORT=7860

CMD ["node", "src/index.js"]
