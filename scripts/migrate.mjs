import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";

// DATABASE_PATH lets tests point at a throwaway database.
const dbPath = path.resolve(process.env.DATABASE_PATH ?? "data/resume.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

console.log(`[migrate] applying drizzle migrations to ${dbPath}`);
migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
console.log("[migrate] done");

sqlite.close();
