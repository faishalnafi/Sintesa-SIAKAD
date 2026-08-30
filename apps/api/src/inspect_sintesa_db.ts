import { db } from "./db/index.js";
import { apiKeys } from "./db/schema/index.js";

async function run() {
  try {
    const keys = await db.select().from(apiKeys);
    console.log("--- SINTESA: api_keys ---");
    console.log(JSON.stringify(keys, null, 2));
  } catch (e) {
    console.error("Error reading SINTESA api_keys:", e);
  }
  process.exit(0);
}

run();
