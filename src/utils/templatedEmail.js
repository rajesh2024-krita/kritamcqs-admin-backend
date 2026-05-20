import { sendEmail } from "./simpleEmail.js";
import { EmailLog } from "../models/index.js";

/**
 * Email template keys - must match API server
 */
export const EMAIL_TEMPLATE_KEYS = {
  AUTH_REGISTRATION: "auth_registration",
  AUTH_WELCOME: "auth_welcome",
  AUTH_ACCOUNT_VERIFICATION: "auth_account_verification",
  AUTH_FORGOT_PASSWORD_OTP: "auth_forgot_password_otp",
  AUTH_LOGIN_OTP: "auth_login_otp",
  INVOICE_GENERATED: "invoice_generated",
  INVOICE_TEST: "invoice_test",
  PAYMENT_SUCCESS: "payment_success",
  PAYMENT_REMINDER: "payment_reminder",
  SMTP_TEST: "smtp_test",
  NOTIFICATION_ANNOUNCEMENT: "notification_announcement",
  NOTIFICATION_UPDATE: "notification_update",
  NOTIFICATION_OFFER: "notification_offer",
  NOTIFICATION_GENERAL: "notification_general",
  NOTIFICATION_REMINDER: "notification_reminder",
  ADMIN_NOTIFICATION: "admin_notification",
  HELPDESK_TICKET_CREATED: "helpdesk_ticket_created",
  HELPDESK_TICKET_REPLY: "helpdesk_ticket_reply",
  HELPDESK_TICKET_CLOSED: "helpdesk_ticket_closed",
  HELPDESK_AUTO_REPLY: "helpdesk_auto_reply",
  SUBSCRIPTION_EXPIRY_REMINDER: "subscription_expiry_reminder",
  SUBSCRIPTION_RENEWAL_REMINDER: "subscription_renewal_reminder",
  SUBSCRIPTION_EXPIRED: "subscription_expired",
};

export const COMMON_EMAIL_VARIABLES = [
  "user_name",
  "email",
  "mobile",
  "app_name",
  "support_email",
  "company_name",
  "invoice_number",
  "invoice_date",
  "payment_amount",
  "invoice_amount",
  "tax_amount",
  "convenience_fee",
  "convenience_fee_gst",
  "total_amount",
  "payment_status",
  "transaction_id",
  "otp",
  "otp_code",
  "otp_expiry",
  "expiry_date",
  "expiry_type",
  "days_before",
  "plan_name",
  "ticket_id",
  "ticket_category",
  "ticket_status",
  "ticket_message",
  "reply_message",
  "admin_email",
  "announcement_title",
  "announcement_message",
  "update_title",
  "update_message",
  "offer_title",
  "offer_code",
  "offer_discount",
  "notification_title",
  "notification_message",
  "broadcast_title",
  "broadcast_body",
  "current_date",
  "current_time",
];

export const EMAIL_TEMPLATE_DEFINITIONS = [
  { key: EMAIL_TEMPLATE_KEYS.SMTP_TEST, name: "SMTP Test Email", module: "Settings", type: "notification", trigger: "Admin sends SMTP test email", variables: ["user_name", "email", "app_name", "company_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.AUTH_REGISTRATION, name: "Registration Confirmation", module: "Authentication", type: "registration", trigger: "New user registration or first Google login", variables: ["user_name", "email", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.AUTH_WELCOME, name: "Welcome Email", module: "Authentication", type: "welcome", trigger: "Welcome message after account creation", variables: ["user_name", "email", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.AUTH_ACCOUNT_VERIFICATION, name: "Account Verification", module: "Authentication", type: "verification", trigger: "Account verification email", variables: ["user_name", "email", "otp", "otp_code", "otp_expiry", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.AUTH_FORGOT_PASSWORD_OTP, name: "Forgot Password OTP", module: "Authentication", type: "forgot_password", trigger: "User requests password reset OTP", variables: ["user_name", "email", "otp", "otp_code", "otp_expiry", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.AUTH_LOGIN_OTP, name: "Login OTP", module: "Authentication", type: "otp_verification", trigger: "User requests login OTP", variables: ["user_name", "email", "otp", "otp_code", "otp_expiry", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.INVOICE_GENERATED, name: "Invoice Generated", module: "Invoices", type: "invoice", trigger: "Invoice is generated or resent", supportsAttachments: true, variables: ["user_name", "customer_name", "email", "invoice_number", "invoice_date", "invoice_amount", "payment_amount", "total_amount", "payment_status", "transaction_id", "due_date", "company_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.INVOICE_TEST, name: "Invoice Test Email", module: "Invoices", type: "invoice", trigger: "Admin sends invoice template test", supportsAttachments: true, variables: ["user_name", "email", "invoice_number", "invoice_amount", "company_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.PAYMENT_SUCCESS, name: "Payment Success", module: "Payments", type: "payment_success", trigger: "Subscription payment succeeds", variables: ["user_name", "email", "plan_name", "payment_amount", "transaction_id", "payment_status", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.PAYMENT_REMINDER, name: "Payment Reminder", module: "Payments", type: "reminder", trigger: "Admin sends invoice payment reminder", variables: ["user_name", "customer_name", "email", "invoice_number", "payment_amount", "due_date", "company_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.NOTIFICATION_ANNOUNCEMENT, name: "Announcement Notification", module: "Notifications", type: "announcement", trigger: "Announcement email notification", variables: ["user_name", "email", "announcement_title", "announcement_message", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.NOTIFICATION_UPDATE, name: "Product Update Notification", module: "Notifications", type: "update", trigger: "Product update email notification", variables: ["user_name", "email", "update_title", "update_message", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.NOTIFICATION_OFFER, name: "Offer Notification", module: "Notifications", type: "offer", trigger: "Offer email notification", variables: ["user_name", "email", "offer_title", "offer_code", "offer_discount", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.NOTIFICATION_GENERAL, name: "General Broadcast Notification", module: "Notifications", type: "broadcast", trigger: "Admin sends broadcast notification email", supportsAttachments: true, variables: ["user_name", "email", "notification_title", "notification_message", "broadcast_title", "broadcast_body", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.NOTIFICATION_REMINDER, name: "Reminder Notification", module: "Notifications", type: "reminder", trigger: "Reminder email notification", variables: ["user_name", "email", "notification_title", "notification_message", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.ADMIN_NOTIFICATION, name: "Admin Notification", module: "Admin", type: "admin_notification", trigger: "System sends notification to admins", variables: ["admin_email", "notification_title", "notification_message", "ticket_id", "ticket_category", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.HELPDESK_TICKET_CREATED, name: "Helpdesk Ticket Created", module: "Helpdesk", type: "helpdesk", trigger: "Support ticket is created", variables: ["user_name", "email", "ticket_id", "ticket_category", "ticket_message", "ticket_status", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.HELPDESK_TICKET_REPLY, name: "Helpdesk Ticket Reply", module: "Helpdesk", type: "helpdesk", trigger: "Admin replies to a support ticket", variables: ["user_name", "email", "ticket_id", "ticket_status", "reply_message", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.HELPDESK_TICKET_CLOSED, name: "Helpdesk Ticket Closed", module: "Helpdesk", type: "helpdesk", trigger: "Support ticket is closed", variables: ["user_name", "email", "ticket_id", "ticket_status", "reply_message", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.HELPDESK_AUTO_REPLY, name: "Helpdesk Auto Reply", module: "Helpdesk", type: "helpdesk", trigger: "Support ticket auto reply is sent", variables: ["user_name", "email", "ticket_id", "ticket_category", "ticket_message", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.SUBSCRIPTION_EXPIRY_REMINDER, name: "Subscription Expiry Reminder", module: "Subscriptions", type: "expiry", trigger: "Subscription expiry reminder job runs", variables: ["user_name", "email", "plan_name", "expiry_date", "days_before", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.SUBSCRIPTION_RENEWAL_REMINDER, name: "Subscription Renewal Reminder", module: "Subscriptions", type: "reminder", trigger: "Subscription renewal reminder job runs", variables: ["user_name", "email", "plan_name", "expiry_date", "days_before", "app_name", "support_email"] },
  { key: EMAIL_TEMPLATE_KEYS.SUBSCRIPTION_EXPIRED, name: "Subscription Expired", module: "Subscriptions", type: "subscription", trigger: "Subscription has expired", variables: ["user_name", "email", "plan_name", "expiry_date", "app_name", "support_email"] },
];

/**
 * Default templates for admin backend (fallback when database not available)
 */
export const DEFAULT_TEMPLATES = {
  [EMAIL_TEMPLATE_KEYS.AUTH_REGISTRATION]: {
    subject: "Welcome to {{app_name}}, {{user_name}}",
    text: "Hi {{user_name}},\n\nYour {{app_name}} account has been created successfully.\n\nFor support, contact {{support_email}}.",
    html: `<p>Hi {{user_name}},</p><p>Your <strong>{{app_name}}</strong> account has been created successfully.</p><p>For support, contact {{support_email}}.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.AUTH_WELCOME]: {
    subject: "Welcome to {{app_name}}",
    text: "Hi {{user_name}},\n\nWelcome to {{app_name}}. You can now continue your preparation.",
    html: `<p>Hi {{user_name}},</p><p>Welcome to <strong>{{app_name}}</strong>. You can now continue your preparation.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.AUTH_ACCOUNT_VERIFICATION]: {
    subject: "Verify your {{app_name}} account",
    text: "Hi {{user_name}},\n\nYour verification OTP is {{otp}}. It expires in {{otp_expiry}}.",
    html: `<p>Hi {{user_name}},</p><p>Your verification OTP is <strong>{{otp}}</strong>.</p><p>It expires in {{otp_expiry}}.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.AUTH_FORGOT_PASSWORD_OTP]: {
    subject: "{{app_name}} password reset OTP",
    text: "Hi {{user_name}},\n\nYour password reset OTP is {{otp}}. It expires in {{otp_expiry}}.",
    html: `<p>Hi {{user_name}},</p><p>Your password reset OTP is <strong>{{otp}}</strong>.</p><p>It expires in {{otp_expiry}}.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.AUTH_LOGIN_OTP]: {
    subject: "{{app_name}} login OTP",
    text: "Hi {{user_name}},\n\nYour login OTP is {{otp}}. It expires in {{otp_expiry}}.",
    html: `<p>Hi {{user_name}},</p><p>Your login OTP is <strong>{{otp}}</strong>.</p><p>It expires in {{otp_expiry}}.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.INVOICE_GENERATED]: {
    subject: "Invoice {{invoice_number}} from {{company_name}}",
    text: "Hi {{customer_name}},\n\nYour invoice {{invoice_number}} for {{invoice_amount}} is attached.\n\nDue date: {{due_date}}\nPayment Status: {{payment_status}}\nTransaction ID: {{transaction_id}}\n\nFor support, contact {{support_email}}.",
    html: `<p>Hi {{customer_name}},</p>
<p>Your invoice <strong>{{invoice_number}}</strong> for <strong>{{invoice_amount}}</strong> is attached.</p>
<p>Due date: {{due_date}}</p>
<p>Payment Status: {{payment_status}}</p>
<p>Transaction ID: {{transaction_id}}</p>
<p>For support, contact {{support_email}}.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.INVOICE_TEST]: {
    subject: "Test Invoice {{invoice_number}} from {{company_name}}",
    text: "Hi {{user_name}},\n\nThis is a test invoice from {{company_name}}. Please verify the layout and email delivery.\n\nNo payment is required.",
    html: `<p>Hi {{user_name}},</p>
<p>This is a test invoice from <strong>{{company_name}}</strong>.</p>
<p>Please verify the layout and email delivery.</p>
<p><strong>No payment is required.</strong></p>`,
  },
  [EMAIL_TEMPLATE_KEYS.PAYMENT_REMINDER]: {
    subject: "Payment Reminder - Invoice {{invoice_number}}",
    text: "Hi {{customer_name}},\n\nThis is a payment reminder for invoice {{invoice_number}}.\n\nAmount Due: {{payment_amount}}\nDue Date: {{due_date}}\nInvoice: {{invoice_number}}\n\nFor support, contact {{support_email}}.",
    html: `<p>Hi {{customer_name}},</p>
<p>This is a payment reminder for invoice <strong>{{invoice_number}}</strong>.</p>
<p>Amount Due: <strong>{{payment_amount}}</strong></p>
<p>Due Date: {{due_date}}</p>
<p>For support, contact {{support_email}}.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.SMTP_TEST]: {
    subject: "SMTP Test Email",
    text: "SMTP is configured correctly.",
    html: "<p>SMTP is configured correctly.</p>",
  },
  [EMAIL_TEMPLATE_KEYS.PAYMENT_SUCCESS]: {
    subject: "Payment successful for {{plan_name}}",
    text: "Hi {{user_name}},\n\nYour payment of {{payment_amount}} was successful.\n\nPlan: {{plan_name}}\nTransaction ID: {{transaction_id}}",
    html: `<p>Hi {{user_name}},</p><p>Your payment of <strong>{{payment_amount}}</strong> was successful.</p><p>Plan: {{plan_name}}</p><p>Transaction ID: {{transaction_id}}</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.NOTIFICATION_ANNOUNCEMENT]: {
    subject: "{{announcement_title}}",
    text: "Hi {{user_name}},\n\n{{announcement_message}}",
    html: `<p>Hi {{user_name}},</p><p>{{announcement_message}}</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.NOTIFICATION_UPDATE]: {
    subject: "{{update_title}}",
    text: "Hi {{user_name}},\n\n{{update_message}}",
    html: `<p>Hi {{user_name}},</p><p>{{update_message}}</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.NOTIFICATION_OFFER]: {
    subject: "{{offer_title}}",
    text: "Hi {{user_name}},\n\nUse code {{offer_code}} to get {{offer_discount}} off.",
    html: `<p>Hi {{user_name}},</p><p>Use code <strong>{{offer_code}}</strong> to get {{offer_discount}} off.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.NOTIFICATION_GENERAL]: {
    subject: "{{broadcast_title}}{{notification_title}}",
    text: "Hi {{user_name}},\n\n{{broadcast_body}}{{notification_message}}",
    html: `<p>Hi {{user_name}},</p><p>{{broadcast_body}}{{notification_message}}</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.NOTIFICATION_REMINDER]: {
    subject: "{{notification_title}}",
    text: "Hi {{user_name}},\n\n{{notification_message}}",
    html: `<p>Hi {{user_name}},</p><p>{{notification_message}}</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.ADMIN_NOTIFICATION]: {
    subject: "{{notification_title}}",
    text: "{{notification_message}}\n\nTicket: {{ticket_id}}\nCategory: {{ticket_category}}",
    html: `<p>{{notification_message}}</p><p>Ticket: <strong>{{ticket_id}}</strong></p><p>Category: {{ticket_category}}</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.HELPDESK_TICKET_CREATED]: {
    subject: "Support ticket received - {{ticket_id}}",
    text: "Hi {{user_name}},\n\nWe received your support request.\n\nTicket ID: {{ticket_id}}\nCategory: {{ticket_category}}\nMessage: {{ticket_message}}",
    html: `<p>Hi {{user_name}},</p><p>We received your support request.</p><p>Ticket ID: <strong>{{ticket_id}}</strong></p><p>Category: {{ticket_category}}</p><p>{{ticket_message}}</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.HELPDESK_TICKET_REPLY]: {
    subject: "Support Reply - Ticket {{ticket_id}}",
    text: "Hi {{user_name}},\n\n{{reply_message}}\n\nTicket ID: {{ticket_id}}\nStatus: {{ticket_status}}\n\nFor support, contact {{support_email}}.",
    html: `<p>Hi {{user_name}},</p>
<p>{{reply_message}}</p>
<p>Ticket ID: <strong>{{ticket_id}}</strong></p>
<p>Status: {{ticket_status}}</p>
<p>For support, contact {{support_email}}.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.HELPDESK_TICKET_CLOSED]: {
    subject: "Support Ticket Closed - {{ticket_id}}",
    text: "Hi {{user_name}},\n\n{{reply_message}}\n\nTicket ID: {{ticket_id}}\nStatus: {{ticket_status}}\n\nThank you for contacting support.",
    html: `<p>Hi {{user_name}},</p>
<p>{{reply_message}}</p>
<p>Ticket ID: <strong>{{ticket_id}}</strong></p>
<p>Status: {{ticket_status}}</p>
<p>Thank you for contacting support.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.HELPDESK_AUTO_REPLY]: {
    subject: "We received your ticket - {{ticket_id}}",
    text: "Hi {{user_name}},\n\nYour ticket {{ticket_id}} has been created. Our support team will respond soon.",
    html: `<p>Hi {{user_name}},</p><p>Your ticket <strong>{{ticket_id}}</strong> has been created.</p><p>Our support team will respond soon.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.SUBSCRIPTION_EXPIRY_REMINDER]: {
    subject: "Your {{plan_name}} plan expires on {{expiry_date}}",
    text: "Hi {{user_name}},\n\nYour {{plan_name}} plan expires on {{expiry_date}}.",
    html: `<p>Hi {{user_name}},</p><p>Your <strong>{{plan_name}}</strong> plan expires on {{expiry_date}}.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.SUBSCRIPTION_RENEWAL_REMINDER]: {
    subject: "Renew your {{plan_name}} plan",
    text: "Hi {{user_name}},\n\nYour {{plan_name}} plan expires on {{expiry_date}}. Please renew to continue access.",
    html: `<p>Hi {{user_name}},</p><p>Your <strong>{{plan_name}}</strong> plan expires on {{expiry_date}}.</p><p>Please renew to continue access.</p>`,
  },
  [EMAIL_TEMPLATE_KEYS.SUBSCRIPTION_EXPIRED]: {
    subject: "Your {{plan_name}} plan has expired",
    text: "Hi {{user_name}},\n\nYour {{plan_name}} plan expired on {{expiry_date}}.",
    html: `<p>Hi {{user_name}},</p><p>Your <strong>{{plan_name}}</strong> plan expired on {{expiry_date}}.</p>`,
  },
};

export function buildDefaultTemplate(definition) {
  const fallback = DEFAULT_TEMPLATES[definition.key] || {};
  return {
    key: definition.key,
    name: definition.name,
    type: definition.type,
    module: definition.module,
    subject: fallback.subject || `${definition.name} - {{app_name}}`,
    htmlContent: fallback.html || `<p>Hi {{user_name}},</p><p>${definition.name}</p>`,
    textContent: fallback.text || `Hi {{user_name}},\n\n${definition.name}`,
    variables: definition.variables || [],
    sampleData: {},
    isActive: true,
    isDefault: true,
  };
}

/**
 * Render template variables - replace {{variable}} with actual values
 */
function renderTemplate(template, variables) {
  return String(template || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => String(variables[key] ?? ""));
}

/**
 * Normalize variables - handle both camelCase and snake_case
 */
function normalizeVariables(variables = {}) {
  const normalized = { ...variables };
  for (const [key, value] of Object.entries(variables)) {
    const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    const camel = key.replace(/_([a-z])/g, (_match, letter) => String(letter).toUpperCase());
    if (normalized[snake] === undefined) normalized[snake] = value;
    if (normalized[camel] === undefined) normalized[camel] = value;
  }
  return normalized;
}

/**
 * Send templated email with logging and proper template rendering
 * Works like the API server's sendTemplatedEmail but for admin backend
 */
function buildHtmlBody(textContent) {
  const text = String(textContent || "").trim();
  const safeText = text
    ? text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br/>")
    : "This email contains no HTML content.";

  return `<html><body><div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:14px;line-height:1.5;">${safeText}</div></body></html>`;
}

export async function sendTemplatedEmail(templateKey, to, variables = {}, attachments = [], { smtp, logger, emailLogModel } = {}) {
  try {
    const payload = normalizeVariables(variables);

    // Get template (fallback to default if not found)
    const template = DEFAULT_TEMPLATES[templateKey];
    
    if (!template) {
      logger?.warn({ templateKey }, "Email template not found; check template key");
      return { skipped: true, reason: `Email template '${templateKey}' not found` };
    }

    // Render template with variables
    const subject = renderTemplate(template.subject, payload);
    const html = renderTemplate(template.html, payload);
    const text = renderTemplate(template.text, payload);
    const htmlBody = html.trim() || buildHtmlBody(text);

    // Log email send attempt
    logger?.info(
      {
        templateKey,
        to,
        subject,
        variables: Object.keys(payload).join(", "),
        htmlLength: htmlBody.length,
        hasAttachments: attachments.length > 0,
      },
      `Sending templated email: ${templateKey}`
    );

    // Send email
    const result = await sendEmail({
      smtp,
      to,
      subject,
      html: htmlBody,
      attachments,
    });

    // Log success/failure
    if (result.skipped) {
      logger?.warn({ templateKey, to, reason: result.reason }, "Email send skipped");
    } else {
      logger?.info({ templateKey, to, subject }, "Email sent successfully");
    }

    return result;
  } catch (error) {
    logger?.error(
      { error: error?.message || String(error), templateKey, to },
      "Email send failed"
    );
    throw error;
  }
}
