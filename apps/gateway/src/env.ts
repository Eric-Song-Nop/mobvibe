import { config } from "dotenv";

// Load .env.{NODE_ENV} (committed defaults), then .env (local overrides with secrets)
const nodeEnv = process.env.NODE_ENV ?? "development";
config({ path: `.env.${nodeEnv}` });
config({ override: true });
