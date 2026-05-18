FROM node:20-alpine

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install

COPY . .

RUN yarn prisma:generate

# RUN bun run prisma:migrate:prod

# Create a startup script
# RUN echo '#!/bin/sh\n\
#     NODE_ENV=production node src/prisma/prisma-environment.js\n\
#     bun run prisma:migrate:prod\n\
#     exec bun run start:prod' > /app/start.sh && chmod +x /app/start.sh


RUN yarn build

EXPOSE 5000

# CMD ["/app/start.sh"]
CMD ["node", "dist/main"]