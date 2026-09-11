/**
 * Load .env before anything else is evaluated.
 *
 * ES module imports are hoisted and evaluated before the importing module's
 * body runs, so calling loadEnvFile() inside ask.ts happens *after* every
 * module it imports has already read process.env. Any module-scope config read
 * would silently see an empty environment and fall back to a default.
 *
 * Importing this module for its side effect, first, is what fixes the ordering:
 * it is evaluated before the imports that follow it. Next loads .env itself, so
 * this is only for the CLI.
 */

import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
