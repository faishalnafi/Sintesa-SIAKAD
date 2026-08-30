import { syncMembersFromIdp } from "./services/sso-member-sync.js";

async function run() {
  console.log("Triggering SSO Members Sync...");
  try {
    const data = await syncMembersFromIdp();
    console.log("SSO Sync data result:", JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("SSO Sync error:", e);
  }
  process.exit(0);
}

run();
