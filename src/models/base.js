import mongoose from "mongoose";

export const { Schema, model, models, Types } = mongoose;

export const baseJsonOptions = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc, ret) => {
      ret.id = ret._id?.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
};
