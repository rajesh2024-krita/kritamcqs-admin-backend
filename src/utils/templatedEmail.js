import { sendEmail } from "./simpleEmail.js";
import { EmailLog } from "../models/index.js";

/**
 * Email template keys - must match API server
 */
export const EMAIL_TEMPLATE_KEYS = {
  INVOICE_GENERATED: "invoice_generated",
  INVOICE_TEST: "invoice_test",
  PAYMENT_REMINDER: "payment_reminder",
  SMTP_TEST: "smtp_test",
  HELPDESK_TICKET_REPLY: "helpdesk_ticket_reply",
  HELPDESK_TICKET_CLOSED: "helpdesk_ticket_closed",
};

/**
 * Default templates for admin backend (fallback when database not available)
 */
export const DEFAULT_TEMPLATES = {
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
};

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

    // Log email send attempt
    logger?.info(
      {
        templateKey,
        to,
        subject,
        variables: Object.keys(payload).join(", "),
        htmlLength: html.length,
        textLength: text.length,
        hasAttachments: attachments.length > 0,
      },
      `Sending templated email: ${templateKey}`
    );

    // Send email
    const result = await sendEmail({
      smtp,
      to,
      subject,
      text,
      html,
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
