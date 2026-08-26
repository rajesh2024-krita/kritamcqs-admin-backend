import { Router } from "express";
import mongoose from "mongoose";
import { Coordinator, User } from "../models/index.js";
import { requireAdmin, hasModulePermission, isMainAdmin } from "../middlewares/auth.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const coordinatorsAdminRouter = Router();
coordinatorsAdminRouter.use(requireAdmin);

const statuses = ["Upcoming", "Reminder Started", "Contact Pending", "Contacted", "Follow-Up Scheduled", "Follow-Up Completed", "Overdue", "Not Interested", "Converted", "On Hold"];
const coordinatorStatuses = ["Active", "Inactive", "On Hold", "Converted"];
const organizationTypes = ["School", "College", "Coaching Centre", "Course Provider", "Other"];
const methods = ["Phone", "WhatsApp", "Email", "Meeting", "Other"];
const actor = (user) => ({ employeeId: user?._id, employeeName: user?.name || "Administrator", employeeEmail: user?.email || "" });
const can = (req, action = "view") => isMainAdmin(req.admin) || hasModulePermission(req.admin, "coordinators", action);
const assertCan = (req, action = "view") => { if (!can(req, action)) throw new AppError("You do not have permission to perform this action", 403); };
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dayStart = (value = new Date()) => { const d = new Date(value); d.setHours(0, 0, 0, 0); return d; };
const addMonths = (value, months) => { const source = new Date(value); const day = source.getDate(); const result = new Date(source); result.setDate(1); result.setMonth(result.getMonth() + months); result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate())); return result; };

function computed(row, now = new Date()) {
  const data = row.toJSON ? row.toJSON() : { ...row, id: String(row._id) };
  const history = [...(data.followUps || [])].sort((a, b) => new Date(b.followUpDate) - new Date(a.followUpDate));
  const last = history[0] || null;
  const sixMonthDate = addMonths(data.addedDate, 6);
  const reminderStartDate = addMonths(data.addedDate, 5);
  const trackedDate = last?.nextFollowUpDate ? new Date(last.nextFollowUpDate) : sixMonthDate;
  const today = dayStart(now);
  const target = dayStart(trackedDate);
  const daysRemaining = Math.ceil((target - today) / 86400000);
  const terminal = ["Follow-Up Completed", "Not Interested", "Converted", "On Hold"].includes(last?.status);
  let followUpStatus = last?.status || "Upcoming";
  if (!terminal) {
    if (daysRemaining < 0) followUpStatus = "Overdue";
    else if (!last && today >= dayStart(reminderStartDate)) followUpStatus = "Reminder Started";
    else if (last?.nextFollowUpDate) followUpStatus = daysRemaining <= 30 ? "Follow-Up Scheduled" : last.status;
  }
  return { ...data, reminderStartDate, sixMonthFollowUpDate: sixMonthDate, lastFollowUpDate: last?.followUpDate || null, nextFollowUpDate: last?.nextFollowUpDate || null, followUpStatus, daysRemaining, reminderActive: !terminal && today >= dayStart(last?.nextFollowUpDate || reminderStartDate) };
}

async function resolveEmployee(id) {
  if (!id) return {};
  if (!mongoose.isValidObjectId(id)) throw new AppError("Invalid assigned team member", 400);
  const employee = await User.findOne({ _id: id, isAdmin: true, isActive: { $ne: false } }).select("name email");
  if (!employee) throw new AppError("Assigned team member not found", 404);
  return actor(employee);
}

function coordinatorPayload(body = {}) {
  const coordinatorName = String(body.coordinatorName || "").trim();
  const schoolCourseName = String(body.schoolCourseName || "").trim();
  if (!coordinatorName || !schoolCourseName) throw new AppError("Coordinator name and school/course name are required", 400);
  if (!organizationTypes.includes(body.organizationType)) throw new AppError("Invalid organization type", 400);
  if (!coordinatorStatuses.includes(body.coordinatorStatus)) throw new AppError("Invalid coordinator status", 400);
  const addedDate = body.addedDate ? new Date(body.addedDate) : new Date();
  if (Number.isNaN(addedDate.getTime())) throw new AppError("Invalid coordinator added date", 400);
  return { coordinatorName, schoolCourseName, organizationType: body.organizationType, contactPerson: String(body.contactPerson || "").trim(), mobileNumber: String(body.mobileNumber || "").trim(), emailAddress: String(body.emailAddress || "").trim(), location: String(body.location || "").trim(), address: String(body.address || "").trim(), expectedUsers: Math.max(0, Number(body.expectedUsers || 0)), notes: String(body.notes || "").trim(), addedDate, coordinatorStatus: body.coordinatorStatus, additionalNotes: String(body.additionalNotes || "").trim() };
}

coordinatorsAdminRouter.get("/coordinator-employees", asyncHandler(async (req, res) => {
  assertCan(req); const rows = await User.find({ isAdmin: true, isActive: { $ne: false } }).select("name email").sort({ name: 1 }).lean();
  res.json({ success: true, data: rows.map((x) => ({ id: String(x._id), name: x.name || "Administrator", email: x.email || "" })) });
}));

coordinatorsAdminRouter.get("/coordinators/summary", asyncHandler(async (req, res) => {
  assertCan(req); const rows = (await Coordinator.find().lean()).map(computed); const now = new Date(); const newSince = new Date(now); newSince.setDate(newSince.getDate() - 30);
  const count = (fn) => rows.filter(fn).length;
  res.json({ success: true, data: { total: rows.length, active: count(x=>x.coordinatorStatus==="Active"), newCoordinators: count(x=>new Date(x.addedDate)>=newSince), upcoming: count(x=>x.followUpStatus==="Reminder Started" || (x.daysRemaining>0&&x.daysRemaining<=30&&!x.reminderActive)), due: count(x=>x.daysRemaining>=0&&x.daysRemaining<=30&&x.reminderActive), overdue: count(x=>x.followUpStatus==="Overdue"), completed: count(x=>x.followUpStatus==="Follow-Up Completed"), converted: count(x=>x.coordinatorStatus==="Converted"||x.followUpStatus==="Converted"), notInterested: count(x=>x.followUpStatus==="Not Interested"), onHold: count(x=>x.coordinatorStatus==="On Hold"||x.followUpStatus==="On Hold"), recentlyContacted: count(x=>x.lastFollowUpDate&&new Date(x.lastFollowUpDate)>=newSince) } });
}));

coordinatorsAdminRouter.get("/coordinators", asyncHandler(async (req, res) => {
  assertCan(req); const page=Math.max(1,Number(req.query.page||1)); const limit=Math.min(100,Math.max(1,Number(req.query.limit||20))); const filter={};
  if(req.query.search){const q={$regex:escapeRegex(req.query.search),$options:"i"};filter.$or=[{coordinatorName:q},{schoolCourseName:q},{contactPerson:q},{mobileNumber:q},{emailAddress:q},{location:q}];}
  if(coordinatorStatuses.includes(req.query.coordinatorStatus)) filter.coordinatorStatus=req.query.coordinatorStatus;
  if(organizationTypes.includes(req.query.organizationType)) filter.organizationType=req.query.organizationType;
  if(mongoose.isValidObjectId(req.query.employeeId)) filter["assignedTeamMember.employeeId"]=req.query.employeeId;
  if(req.query.from||req.query.to){filter.addedDate={};if(req.query.from)filter.addedDate.$gte=new Date(req.query.from);if(req.query.to){const d=new Date(req.query.to);d.setHours(23,59,59,999);filter.addedDate.$lte=d;}}
  let rows=(await Coordinator.find(filter).sort({addedDate:-1})).map(computed);
  if(statuses.includes(req.query.followUpStatus)) rows=rows.filter(x=>x.followUpStatus===req.query.followUpStatus);
  if(req.query.schoolCourse) rows=rows.filter(x=>x.schoolCourseName.toLowerCase().includes(String(req.query.schoolCourse).toLowerCase()));
  const sortKey=["coordinatorName","schoolCourseName","addedDate","sixMonthFollowUpDate","nextFollowUpDate","followUpStatus"].includes(req.query.sortBy)?req.query.sortBy:"addedDate"; const direction=req.query.sortOrder==="asc"?1:-1;
  rows.sort((a,b)=>String(a[sortKey]||"").localeCompare(String(b[sortKey]||""))*direction); const total=rows.length; rows=rows.slice((page-1)*limit,page*limit);
  res.json({success:true,data:rows,meta:{page,limit,total,totalPages:Math.max(1,Math.ceil(total/limit))}});
}));

coordinatorsAdminRouter.post("/coordinators", asyncHandler(async(req,res)=>{assertCan(req,"create");const assignedTeamMember=await resolveEmployee(req.body?.assignedTeamMemberId);const item=await Coordinator.create({...coordinatorPayload(req.body),assignedTeamMember,createdBy:actor(req.admin),updatedBy:actor(req.admin)});res.status(201).json({success:true,data:computed(item)});}));
coordinatorsAdminRouter.get("/coordinators/:id", asyncHandler(async(req,res)=>{assertCan(req);const item=await Coordinator.findById(req.params.id);if(!item)throw new AppError("Coordinator not found",404);res.json({success:true,data:computed(item)});}));
coordinatorsAdminRouter.put("/coordinators/:id", asyncHandler(async(req,res)=>{assertCan(req,"edit");const item=await Coordinator.findById(req.params.id);if(!item)throw new AppError("Coordinator not found",404);Object.assign(item,coordinatorPayload(req.body),{assignedTeamMember:await resolveEmployee(req.body?.assignedTeamMemberId),updatedBy:actor(req.admin)});await item.save();res.json({success:true,data:computed(item)});}));
coordinatorsAdminRouter.delete("/coordinators/:id", asyncHandler(async(req,res)=>{assertCan(req,"delete");const item=await Coordinator.findByIdAndDelete(req.params.id);if(!item)throw new AppError("Coordinator not found",404);res.json({success:true,message:"Coordinator deleted"});}));
coordinatorsAdminRouter.post("/coordinators/:id/follow-ups", asyncHandler(async(req,res)=>{assertCan(req,"create");const item=await Coordinator.findById(req.params.id);if(!item)throw new AppError("Coordinator not found",404);if(!methods.includes(req.body?.contactMethod)||!statuses.includes(req.body?.status)||!String(req.body?.discussionDetails||"").trim())throw new AppError("Contact method, status and discussion details are required",400);const followUpDate=req.body.followUpDate?new Date(req.body.followUpDate):new Date();const next=req.body.nextFollowUpDate?new Date(req.body.nextFollowUpDate):undefined;if(Number.isNaN(followUpDate.getTime())||(next&&Number.isNaN(next.getTime())))throw new AppError("Invalid follow-up date",400);item.followUps.push({followUpDate,contactMethod:req.body.contactMethod,contactedPerson:String(req.body.contactedPerson||"").trim(),discussionDetails:String(req.body.discussionDetails).trim(),requirementInterest:String(req.body.requirementInterest||"").trim(),currentResponse:String(req.body.currentResponse||"").trim(),status:req.body.status,nextFollowUpDate:next,assignedTeamMember:await resolveEmployee(req.body.assignedTeamMemberId),remarks:String(req.body.remarks||"").trim(),recordedBy:actor(req.admin)});if(req.body.assignedTeamMemberId)item.assignedTeamMember=await resolveEmployee(req.body.assignedTeamMemberId);if(req.body.status==="Converted")item.coordinatorStatus="Converted";if(req.body.status==="On Hold")item.coordinatorStatus="On Hold";item.updatedBy=actor(req.admin);await item.save();res.status(201).json({success:true,data:computed(item)});}));
