// src/infrastructure/prisma/prisma-environment.js
import dotenv from "dotenv";
import path from "path";

// Load .env file
dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

// Log a confirmation (optional)
