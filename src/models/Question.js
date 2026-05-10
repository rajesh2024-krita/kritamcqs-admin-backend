import { Schema, Types, model, models, baseJsonOptions } from "./base.js";
import { EXAMS, QUESTION_DIFFICULTIES, QUESTION_RESPONSE_TYPES } from "../types/constants.js";

const questionSchema = new Schema(
  {
    subjectId: { type: Types.ObjectId, ref: "Subject", required: true, index: true },
    chapterId: { type: Types.ObjectId, ref: "Chapter", index: true },
    topicId: { type: Types.ObjectId, ref: "Topic", required: true, index: true },
    yearId: { type: Types.ObjectId, ref: "Year", index: true },
    difficultyId: { type: Types.ObjectId, ref: "Difficulty", index: true },
    questionTypeId: { type: Types.ObjectId, ref: "QuestionType", required: true, index: true },
    question: { type: String, required: true, trim: true },
    questionImageUrl: { type: String, trim: true },
    optionA: { type: String, trim: true },
    optionAImageUrl: { type: String, trim: true },
    optionB: { type: String, trim: true },
    optionBImageUrl: { type: String, trim: true },
    optionC: { type: String, trim: true },
    optionCImageUrl: { type: String, trim: true },
    optionD: { type: String, trim: true },
    optionDImageUrl: { type: String, trim: true },
    correctOption: { type: String, enum: ["A", "B", "C", "D"] },
    explanation: { type: String, trim: true },
    difficulty: { type: String, enum: QUESTION_DIFFICULTIES, required: true, index: true },
    examMode: { type: String, required: true, trim: true, index: true },
    exam: { type: String, enum: EXAMS, required: true, index: true },
    responseType: { type: String, enum: QUESTION_RESPONSE_TYPES, default: "single", index: true },
    conceptTags: { type: [String], default: [] },
    numericAnswer: { type: String, trim: true },
    passage: { type: String, trim: true },
    hasDiagram: { type: Boolean, default: false },
    isNumerical: { type: Boolean, default: false },
  },
  baseJsonOptions,
);

questionSchema.index({ subjectId: 1, chapterId: 1, topicId: 1, yearId: 1, difficultyId: 1, questionTypeId: 1, difficulty: 1 });

export const Question = models.Question || model("Question", questionSchema);
