import dotenv from "dotenv";

dotenv.config();

const required = ["MONGODB_URI", "JWT_SECRET"];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`${key} is required`);
  }
}

export const env = {
  port: Number(process.env.PORT || 3001),
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  sessionSecret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
  clientOrigin: process.env.CLIENT_ORIGIN || "*",
  appAssetBaseUrl: process.env.APP_ASSET_BASE_URL || "",
};
