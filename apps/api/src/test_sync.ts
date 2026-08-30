import "dotenv/config";
import { ssoListMembers } from "./services/sso-api-client.js";

async function main() {
  for (const size of [5, 10, 20, 50, 100]) {
    try {
      const res = await ssoListMembers({ page: 1, per_page: size });
      console.log(`per_page=${size} SUCCESS: count=${res.data.length}`);
    } catch (err: any) {
      console.log(`per_page=${size} FAILED: ${err.message}`);
    }
  }
  process.exit(0);
}

main();
