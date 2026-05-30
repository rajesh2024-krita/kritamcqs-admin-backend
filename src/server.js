import { app } from "./app.js";
import { connectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { startMockTestGenerationScheduler } from "./routes/admin.js";

async function start() {
  await connectDb();
  startMockTestGenerationScheduler();
  app.listen(env.port, () => {
    console.log(`Admin backend running on http://localhost:${env.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start backend", error);
  process.exit(1);
});
