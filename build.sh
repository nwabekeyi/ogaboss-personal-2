#!/bin/bash
npm install
npm run prisma:generate
npm run build
# npm run prisma:migrate:prod
npm run seed