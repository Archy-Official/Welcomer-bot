FROM node:22-alpine
WORKDIR /app

# Install native compilation build chains and font rendering dependencies for skia-canvas on Alpine
RUN apk add --no-cache python3 py3-pip make g++ fontconfig ttf-dejavu freetype freetype-dev fribidi

# CRITICAL: Install the official Hugging Face Hub package for Python to utilize the batch engine
RUN pip3 install --no-cache-dir huggingface_hub --break-system-packages

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 7860
ENV PORT=7860

CMD ["node", "src/index.js"]