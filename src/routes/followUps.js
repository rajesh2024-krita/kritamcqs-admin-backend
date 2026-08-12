import { Router } from "express";
import mongoose from "mongoose";
import { FollowUp, User, AppUsageSession } from "../models/index.js";
import { requireAdmin, hasModulePermission, isMainAdmin } from "../middlewares/auth.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const followUpsAdminRouter = Router();
followUpsAdminRouter.use(requireAdmin);
const statuses = ["Pending", "Progress", "Completed", "Cancelled"];
const actor = (user) => ({ employeeId: user._id, employeeName: user.name || "Administrator", employeeEmail: user.email || "" });
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const can = (req, module, action = "view") => isMainAdmin(req.admin) || hasModulePermission(req.admin, module, action);
const assertCan = (req, module, action = "view") => { if (!can(req, module, action)) throw new AppError("You do not have permission to perform this action", 403); };
const employeeScope = (req) => isMainAdmin(req.admin) ? {} : { "assignedEmployee.employeeId": req.admin._id };

async function hydrate(rows) {
  const userIds = rows.map((row) => row.userId);
  const [users, sessions] = await Promise.all([
    User.find({ _id: { $in: userIds } }).lean(),
    AppUsageSession.aggregate([{ $match: { userId: { $in: userIds.map(String) } } }, { $sort: { startedAt: -1 } }, { $group: { _id: "$userId", device: { $first: "$deviceModel" }, brand: { $first: "$deviceBrand" } } }]),
  ]);
  const userMap = new Map(users.map((user) => [String(user._id), user]));
  const deviceMap = new Map(sessions.map((item) => [String(item._id), [item.brand, item.device].filter(Boolean).join(" ")]));
  return rows.map((row) => ({ ...row.toJSON(), user: { ...userMap.get(String(row.userId)), id: String(row.userId), deviceName: deviceMap.get(String(row.userId)) || "Unknown" }, conversationCount: row.conversations.length }));
}

followUpsAdminRouter.get("/user-management", asyncHandler(async (req, res) => {
  assertCan(req, "user-management");
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const filter = { isAdmin: { $ne: true } };
  const textFields = [["name", req.query.name], ["email", req.query.email]];
  textFields.forEach(([key, value]) => { if (value) filter[key] = { $regex: escapeRegex(value), $options: "i" }; });
  if (req.query.examMode) filter.examMode = { $regex: `^${escapeRegex(req.query.examMode)}`, $options: "i" };
  if (req.query.plan === "Premium") filter.isPremium = true;
  if (req.query.plan === "Free") filter.isPremium = { $ne: true };
  if (req.query.from || req.query.to) { filter.createdAt = {}; if (req.query.from) filter.createdAt.$gte = new Date(req.query.from); if (req.query.to) { const d = new Date(req.query.to); d.setUTCHours(23,59,59,999); filter.createdAt.$lte = d; } }
  let followMap = new Map();
  if (req.query.followUpStatus || req.query.employeeId || !isMainAdmin(req.admin)) {
    const ff = { ...employeeScope(req) };
    if (req.query.followUpStatus === "Unassigned") ff._id = null;
    else if (req.query.followUpStatus) ff.status = req.query.followUpStatus;
    if (isMainAdmin(req.admin) && mongoose.isValidObjectId(req.query.employeeId)) ff["assignedEmployee.employeeId"] = req.query.employeeId;
    const matches = ff._id === null ? [] : await FollowUp.find(ff).select("userId").lean();
    filter._id = req.query.followUpStatus === "Unassigned" ? { $nin: (await FollowUp.find().distinct("userId")) } : { $in: matches.map((x) => x.userId) };
  }
  const [users, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean(), User.countDocuments(filter)]);
  const ids = users.map((u) => u._id);
  const [followUps, devices] = await Promise.all([FollowUp.find({ userId: { $in: ids } }).lean(), AppUsageSession.aggregate([{ $match: { userId: { $in: ids.map(String) } } }, { $sort: { startedAt: -1 } }, { $group: { _id: "$userId", device: { $first: "$deviceModel" }, brand: { $first: "$deviceBrand" } } }])]);
  followMap = new Map(followUps.map((f) => [String(f.userId), f])); const deviceMap = new Map(devices.map((d) => [String(d._id), [d.brand,d.device].filter(Boolean).join(" ")]));
  res.json({ success:true, data: users.map((u) => ({ ...u, id:String(u._id), _id:undefined, deviceName:deviceMap.get(String(u._id))||"Unknown", followUp:followMap.get(String(u._id))||null })), meta:{page,limit,total,totalPages:Math.max(1,Math.ceil(total/limit))} });
}));

followUpsAdminRouter.get("/follow-up-employees", asyncHandler(async (req,res) => {
  if (!can(req,"user-management") && !can(req,"follow-ups")) throw new AppError("You do not have permission to view employees",403);
  const employees=await User.find({isAdmin:true,adminRole:"employee",isActive:{$ne:false}}).select("name email").sort({name:1}).lean();
  res.json({success:true,data:employees.map(e=>({id:String(e._id),name:e.name||"",email:e.email||""}))});
}));

followUpsAdminRouter.get("/follow-ups", asyncHandler(async (req,res) => {
  assertCan(req,"follow-ups"); const page=Math.max(1,Number(req.query.page||1)); const limit=Math.min(100,Math.max(1,Number(req.query.limit||20))); const filter={...employeeScope(req)};
  if (statuses.includes(req.query.status)) filter.status=req.query.status;
  if (isMainAdmin(req.admin) && mongoose.isValidObjectId(req.query.employeeId)) filter["assignedEmployee.employeeId"]=req.query.employeeId;
  const [rows,total,counts]=await Promise.all([FollowUp.find(filter).sort({updatedAt:-1}).skip((page-1)*limit).limit(limit),FollowUp.countDocuments(filter),FollowUp.aggregate([{ $match: employeeScope(req) },{$group:{_id:"$status",count:{$sum:1}}}])]);
  res.json({success:true,data:await hydrate(rows),meta:{page,limit,total,totalPages:Math.max(1,Math.ceil(total/limit)),counts:Object.fromEntries(statuses.map(s=>[s,counts.find(c=>c._id===s)?.count||0]))}});
}));

followUpsAdminRouter.get("/follow-ups/:id", asyncHandler(async(req,res)=>{ assertCan(req,"follow-ups"); const row=await FollowUp.findOne({_id:req.params.id,...employeeScope(req)}); if(!row) throw new AppError("Follow-up not found",404); res.json({success:true,data:(await hydrate([row]))[0]}); }));
followUpsAdminRouter.post("/follow-ups/assign", asyncHandler(async(req,res)=>{ assertCan(req,"user-management","create"); const {userId,employeeId}=req.body||{}; const employee=await User.findOne({_id:employeeId,isAdmin:true,adminRole:"employee",isActive:{$ne:false}}); if(!employee) throw new AppError("Active employee not found",404); const now=new Date(); const existing=await FollowUp.findOne({userId}); if(existing){ if(!isMainAdmin(req.admin)) throw new AppError("Only main admins can reassign follow-ups",403); existing.assignedEmployee=actor(employee); existing.assignedBy=actor(req.admin); existing.assignedAt=now; await existing.save(); return res.json({success:true,data:existing}); } const item=await FollowUp.create({userId,assignedEmployee:actor(employee),assignedBy:actor(req.admin),assignedAt:now,status:"Pending",statusHistory:[{from:null,to:"Pending",changedAt:now,changedBy:actor(req.admin)}]}); res.status(201).json({success:true,data:item}); }));
followUpsAdminRouter.post("/follow-ups/:id/conversations", asyncHandler(async(req,res)=>{ assertCan(req,"follow-ups","create"); const row=await FollowUp.findOne({_id:req.params.id,...employeeScope(req)}); if(!row) throw new AppError("Follow-up not found",404); const type=String(req.body?.type||""); const notes=String(req.body?.notes||"").trim(); if(!["Call","Chat","Email","Other"].includes(type)||!notes) throw new AppError("Conversation type and notes are required",400); const occurredAt=req.body.occurredAt?new Date(req.body.occurredAt):new Date(); const next=req.body.nextFollowUpAt?new Date(req.body.nextFollowUpAt):undefined; const nextStatus=statuses.includes(req.body.status)?req.body.status:(row.status==="Pending"?"Progress":row.status); row.conversations.push({occurredAt,type,notes,nextFollowUpAt:next,status:nextStatus,handledBy:actor(req.admin)}); row.lastFollowUpAt=occurredAt; row.nextFollowUpAt=next; if(nextStatus!==row.status){row.statusHistory.push({from:row.status,to:nextStatus,changedAt:new Date(),changedBy:actor(req.admin)});row.status=nextStatus;} await row.save(); res.status(201).json({success:true,data:row}); }));
followUpsAdminRouter.patch("/follow-ups/:id/status", asyncHandler(async(req,res)=>{ assertCan(req,"follow-ups","edit"); const next=String(req.body?.status||""); if(!statuses.includes(next)) throw new AppError("Invalid follow-up status",400); const row=await FollowUp.findOne({_id:req.params.id,...employeeScope(req)}); if(!row) throw new AppError("Follow-up not found",404); if(row.status!==next){row.statusHistory.push({from:row.status,to:next,changedAt:new Date(),changedBy:actor(req.admin)});row.status=next;await row.save();} res.json({success:true,data:row}); }));

followUpsAdminRouter.get("/employees-follow-up-summary", asyncHandler(async(req,res)=>{ if(!isMainAdmin(req.admin)) throw new AppError("Main admin access required",403); const employees=await User.find({isAdmin:true,adminRole:"employee"}).select("name email adminRole").lean(); const stats=await FollowUp.aggregate([{$group:{_id:{employee:"$assignedEmployee.employeeId",status:"$status"},count:{$sum:1}}}]); res.json({success:true,data:employees.map(e=>{const counts=Object.fromEntries(statuses.map(s=>[s,stats.find(x=>String(x._id.employee)===String(e._id)&&x._id.status===s)?.count||0]));return {...e,id:String(e._id),role:"Employee",followUpCounts:counts,totalFollowUps:Object.values(counts).reduce((a,b)=>a+b,0)};})}); }));
