import { Schema, model, models, baseJsonOptions } from "./base.js";

const actorSchema = new Schema({
  employeeId: { type: Schema.Types.ObjectId, ref: "User" },
  employeeName: { type: String, trim: true, default: "" },
  employeeEmail: { type: String, trim: true, lowercase: true, default: "" },
}, { _id: false });

const followUpSchema = new Schema({
  followUpDate: { type: Date, required: true },
  contactMethod: { type: String, enum: ["Phone", "WhatsApp", "Email", "Meeting", "Other"], required: true },
  contactedPerson: { type: String, trim: true, default: "" },
  discussionDetails: { type: String, trim: true, required: true, maxlength: 10000 },
  requirementInterest: { type: String, trim: true, default: "" },
  currentResponse: { type: String, trim: true, default: "" },
  status: { type: String, enum: ["Upcoming", "Reminder Started", "Contact Pending", "Contacted", "Follow-Up Scheduled", "Follow-Up Completed", "Overdue", "Not Interested", "Converted", "On Hold"], required: true },
  nextFollowUpDate: { type: Date },
  assignedTeamMember: { type: actorSchema, default: () => ({}) },
  remarks: { type: String, trim: true, default: "" },
  recordedBy: { type: actorSchema, required: true },
}, { timestamps: true });

const coordinatorSchema = new Schema({
  coordinatorName: { type: String, required: true, trim: true, index: true },
  schoolCourseName: { type: String, required: true, trim: true, index: true },
  organizationType: { type: String, enum: ["School", "College", "Coaching Centre", "Course Provider", "Other"], required: true },
  contactPerson: { type: String, trim: true, default: "" },
  mobileNumber: { type: String, trim: true, default: "" },
  emailAddress: { type: String, trim: true, lowercase: true, default: "" },
  location: { type: String, trim: true, default: "", index: true },
  address: { type: String, trim: true, default: "" },
  expectedUsers: { type: Number, min: 0, default: 0 },
  notes: { type: String, trim: true, default: "" },
  addedDate: { type: Date, required: true, default: Date.now, index: true },
  coordinatorStatus: { type: String, enum: ["Active", "Inactive", "On Hold", "Converted"], default: "Active", index: true },
  assignedTeamMember: { type: actorSchema, default: () => ({}) },
  additionalNotes: { type: String, trim: true, default: "" },
  followUps: { type: [followUpSchema], default: [] },
  createdBy: { type: actorSchema, required: true },
  updatedBy: { type: actorSchema, required: true },
}, baseJsonOptions);

coordinatorSchema.index({ schoolCourseName: 1, coordinatorStatus: 1, addedDate: -1 });
coordinatorSchema.index({ "assignedTeamMember.employeeId": 1, addedDate: -1 });

export const Coordinator = models.Coordinator || model("Coordinator", coordinatorSchema);
