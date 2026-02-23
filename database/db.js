import pkg from "pg";
import { config } from "dotenv";
const { Client } = pkg;

config({ path: "./config/config.env" });

const connectionString = process.env.DATABASE_URL;

const database = connectionString
  ? new Client({
      connectionString,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false,
    })
  : new Client({
      user: process.env.DB_USER || process.env.POSTGRES_USER || "postgres",
      host: process.env.DB_HOST || "localhost",
      database:
        process.env.DB_NAME || process.env.POSTGRES_DB || "mern_ecommerce_store",
      password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || "",
      port: Number(process.env.DB_PORT || 5432),
    });

try {
  await database.connect();
  console.log("Connected to the database successfully");
} catch (error) {
  console.error("Database connection failed:", error);
  process.exit(1);
}

export default database;
