import mongoose from "mongoose";
import { env } from "./env.js";
import { Difficulty, Subject } from "../models/index.js";

const DEFAULT_DIFFICULTIES = [
  { key: "easy", name: "Easy", description: "Basic and direct questions.", sortOrder: 1 },
  { key: "moderate", name: "Moderate", description: "Intermediate conceptual and application questions.", sortOrder: 2 },
  { key: "hard", name: "Hard", description: "Challenging questions requiring deeper understanding.", sortOrder: 3 },
  { key: "mixed", name: "Mixed", description: "A combined set across all difficulty levels.", sortOrder: 4 },
];

export async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri);
  await Promise.all(
    DEFAULT_DIFFICULTIES.map((item) =>
      Difficulty.findOneAndUpdate({ key: item.key }, { $set: item }, { upsert: true, new: true, setDefaultsOnInsert: true }),
    ),
  );
  await Subject.syncIndexes();
  return mongoose.connection;
}
