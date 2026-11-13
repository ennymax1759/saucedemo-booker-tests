import { parseEnv } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

let loaded = false;

/**
 * Automatically locates and loads environment variables from env.local or .env.local
 * from the project root or workspace directory.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  const candidatePaths = [
    path.resolve(process.cwd(), 'env.local'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(__dirname, '../env.local'),
    path.resolve(__dirname, '../.env.local'),
    path.resolve(__dirname, '../../env.local'),
    path.resolve(__dirname, '../../.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      for (const [name,value] of Object.entries(parseEnv(fs.readFileSync(envPath, 'utf8')))) {
        process.env[name] ??= value;
      }
    }
  }
}

// Ensure env variables are initialized upon import
loadEnv();

/**
 * Returns SauceDemo credentials from env.local.
 */
export function getSauceCredentials(): { username: string; password: string } {
  loadEnv();
  const username = process.env.SAUCEDEMO_USERNAME ?? process.env.SAUCE_USERNAME ?? '';
  const password = process.env.SAUCEDEMO_PASSWORD ?? process.env.SAUCE_PASSWORD ?? '';
  return { username, password };
}

/**
 * Returns Booker API credentials from env.local.
 */
export function getBookerCredentials(): { username: string; password: string } {
  loadEnv();
  const username = process.env.BOOKER_USERNAME ?? process.env.API_USERNAME ?? 'admin';
  const password = process.env.BOOKER_PASSWORD ?? process.env.API_PASSWORD ?? 'password123';
  return { username, password };
}
