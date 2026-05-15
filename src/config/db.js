import mongoose from "mongoose";
import { env } from "./env.js";
import { Subject } from "../models/index.js";

export async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri);
  await Subject.syncIndexes();
  return mongoose.connection;
}
