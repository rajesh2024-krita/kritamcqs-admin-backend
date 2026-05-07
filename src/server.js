import { app } from "./app.js";
import { connectDb } from "./config/db.js";
import { env } from "./config/env.js";

async function start() {
  await connectDb();
  app.listen(env.port, () => {
    console.log(`Admin backend running on http://localhost:${env.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
