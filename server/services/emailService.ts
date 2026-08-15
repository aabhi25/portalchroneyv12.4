import type { SupportTicket } from '@shared/schema';

interface EmailTemplate {
  subject: string;
  htmlContent: string;
  textContent: string;
}

interface SendEmailParams {
  to: string;
  from: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
}

export class EmailService {
  private sendGridApiKey: string | null = null;
  private fromEmail: string = 'support@chroney.ai'; // Default from email
  private isConfigured: boolean = false;

  constructor() {
    // Check for SendGrid API key in environment
    this.sendGridApiKey = process.env.SENDGRID_API_KEY || null;
    this.isConfigured = !!this.sendGridApiKey;
    
    if (!this.isConfigured) {
      console.log('SendGrid not configured - email notifications will be skipped');
    }
  }

  configure(apiKey: string, fromEmail?: string) {
    this.sendGridApiKey = apiKey;
    this.isConfigured = true;
    if (fromEmail) {
      this.fromEmail = fromEmail;
    }
  }

  private async sendEmail(params: SendEmailParams): Promise<boolean> {
    if (!this.isConfigured || !this.sendGridApiKey) {
      console.log('Email not sent - SendGrid not configured:', params.subject);
      return false;
    }

    try {
      // TODO: Implement actual SendGrid API integration when API keys are provided
      // For now, just log what would be sent
      console.log('Would send email:', {
        to: params.to,
        from: params.from,
        subject: params.subject,
        contentLength: params.htmlContent.length
      });
      
      // Placeholder for SendGrid implementation:
      /*
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(this.sendGridApiKey);
      
      await sgMail.send({
        to: params.to,
        from: params.from,
        subject: params.subject,
        html: params.htmlContent,
        text: params.textContent || params.htmlContent.replace(/<[^>]*>/g, '')
      });
      */
      
      return true;
    } catch (error: any) {
      console.error('Email send error:', error);
      return false;
    }
  }

  // Template generators
  private generateTicketCreatedTemplate(ticket: SupportTicket, businessName: string): EmailTemplate {
    const subject = `Ticket #${ticket.ticketNumber} Created: ${ticket.subject}`;
    
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .ticket-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
    .label { font-weight: bold; color: #667eea; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    .btn { display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Support Ticket Created</h1>
      <p>Ticket #${ticket.ticketNumber}</p>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>Your support ticket has been created successfully. Our team will review it and get back to you soon.</p>
      
      <div class="ticket-info">
        <p><span class="label">Subject:</span> ${ticket.subject}</p>
        <p><span class="label">Priority:</span> ${ticket.priority.toUpperCase()}</p>
        <p><span class="label">Status:</span> ${ticket.status}</p>
        <p><span class="label">Category:</span> ${ticket.category || 'General'}</p>
        <hr>
        <p><span class="label">Description:</span></p>
        <p>${ticket.description}</p>
      </div>
      
      <p>We aim to respond to all tickets within 24 hours. You can track the status of your ticket using the ticket number above.</p>
      
      <p>Best regards,<br>${businessName} Support Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message from ${businessName}. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

    const textContent = `
Support Ticket Created - Ticket #${ticket.ticketNumber}

Hello,

Your support ticket has been created successfully. Our team will review it and get back to you soon.

Subject: ${ticket.subject}
Priority: ${ticket.priority.toUpperCase()}
Status: ${ticket.status}
Category: ${ticket.category || 'General'}

Description:
${ticket.description}

We aim to respond to all tickets within 24 hours.

Best regards,
${businessName} Support Team
`;

    return { subject, htmlContent, textContent };
  }

  private generateTicketUpdatedTemplate(ticket: SupportTicket, updateMessage: string, businessName: string): EmailTemplate {
    const subject = `Ticket #${ticket.ticketNumber} Updated: ${ticket.subject}`;
    
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .update-box { background: #e0e7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4f46e5; }
    .ticket-info { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .label { font-weight: bold; color: #667eea; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Ticket Update</h1>
      <p>Ticket #${ticket.ticketNumber}</p>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>There's an update on your support ticket:</p>
      
      <div class="update-box">
        <p><strong>Update:</strong></p>
        <p>${updateMessage}</p>
      </div>
      
      <div class="ticket-info">
        <p><span class="label">Subject:</span> ${ticket.subject}</p>
        <p><span class="label">Current Status:</span> ${ticket.status}</p>
        <p><span class="label">Priority:</span> ${ticket.priority.toUpperCase()}</p>
      </div>
      
      <p>Best regards,<br>${businessName} Support Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message from ${businessName}. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

    const textContent = `
Ticket Update - Ticket #${ticket.ticketNumber}

Hello,

There's an update on your support ticket:

Update:
${updateMessage}

Subject: ${ticket.subject}
Current Status: ${ticket.status}
Priority: ${ticket.priority.toUpperCase()}

Best regards,
${businessName} Support Team
`;

    return { subject, htmlContent, textContent };
  }

  private generateTicketResolvedTemplate(ticket: SupportTicket, resolutionSummary: string, businessName: string): EmailTemplate {
    const subject = `Ticket #${ticket.ticketNumber} Resolved: ${ticket.subject}`;
    
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .resolution-box { background: #d1fae5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981; }
    .ticket-info { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .label { font-weight: bold; color: #10b981; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    .rating { text-align: center; margin: 20px 0; }
    .star { font-size: 24px; color: #fbbf24; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Ticket Resolved</h1>
      <p>Ticket #${ticket.ticketNumber}</p>
    </div>
    <div class="content">
      <p>Hello,</p>
      <p>Great news! Your support ticket has been resolved.</p>
      
      <div class="resolution-box">
        <p><strong>Resolution:</strong></p>
        <p>${resolutionSummary}</p>
      </div>
      
      <div class="ticket-info">
        <p><span class="label">Subject:</span> ${ticket.subject}</p>
        <p><span class="label">Status:</span> Resolved</p>
        ${ticket.autoResolved === 'true' ? '<p><span class="label">Resolved By:</span> AI Auto-Resolution</p>' : ''}
      </div>
      
      <div class="rating">
        <p><strong>How would you rate this support experience?</strong></p>
        <p>We'd love to hear your feedback!</p>
      </div>
      
      <p>If you need any further assistance, please don't hesitate to reach out.</p>
      
      <p>Best regards,<br>${businessName} Support Team</p>
    </div>
    <div class="footer">
      <p>This is an automated message from ${businessName}. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;

    const textContent = `
Ticket Resolved - Ticket #${ticket.ticketNumber}

Hello,

Great news! Your support ticket has been resolved.

Resolution:
${resolutionSummary}

Subject: ${ticket.subject}
Status: Resolved
${ticket.autoResolved === 'true' ? 'Resolved By: AI Auto-Resolution' : ''}

If you need any further assistance, please don't hesitate to reach out.

Best regards,
${businessName} Support Team
`;

    return { subject, htmlContent, textContent };
  }

  // Public methods to send ticket emails
  async sendTicketCreatedEmail(
    customerEmail: string,
    ticket: SupportTicket,
    businessName: string
  ): Promise<boolean> {
    const template = this.generateTicketCreatedTemplate(ticket, businessName);
    
    return this.sendEmail({
      to: customerEmail,
      from: this.fromEmail,
      subject: template.subject,
      htmlContent: template.htmlContent,
      textContent: template.textContent
    });
  }

  async sendTicketUpdatedEmail(
    customerEmail: string,
    ticket: SupportTicket,
    updateMessage: string,
    businessName: string
  ): Promise<boolean> {
    const template = this.generateTicketUpdatedTemplate(ticket, updateMessage, businessName);
    
    return this.sendEmail({
      to: customerEmail,
      from: this.fromEmail,
      subject: template.subject,
      htmlContent: template.htmlContent,
      textContent: template.textContent
    });
  }

  async sendTicketResolvedEmail(
    customerEmail: string,
    ticket: SupportTicket,
    resolutionSummary: string,
    businessName: string
  ): Promise<boolean> {
    const template = this.generateTicketResolvedTemplate(ticket, resolutionSummary, businessName);
    
    return this.sendEmail({
      to: customerEmail,
      from: this.fromEmail,
      subject: template.subject,
      htmlContent: template.htmlContent,
      textContent: template.textContent
    });
  }

  async sendAgentNotification(
    agentEmail: string,
    ticket: SupportTicket,
    notificationType: 'new_ticket' | 'high_priority' | 'churn_risk',
    businessName: string
  ): Promise<boolean> {
    let subject = '';
    let message = '';
    
    switch (notificationType) {
      case 'new_ticket':
        subject = `New Ticket #${ticket.ticketNumber}: ${ticket.subject}`;
        message = `A new support ticket requires your attention.`;
        break;
      case 'high_priority':
        subject = `🔴 HIGH PRIORITY - Ticket #${ticket.ticketNumber}`;
        message = `This ticket has been marked as high priority and requires immediate attention.`;
        break;
      case 'churn_risk':
        subject = `⚠️ CHURN RISK - Ticket #${ticket.ticketNumber}`;
        message = `AI has detected high churn risk. Customer may be at risk of cancellation.`;
        break;
    }
    
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .alert { background: #fee2e2; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #dc2626; }
    .ticket-info { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
    .label { font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>${subject}</h2>
    </div>
    <div class="content">
      <div class="alert">
        <p><strong>${message}</strong></p>
      </div>
      
      <div class="ticket-info">
        <p><span class="label">Customer:</span> ${ticket.customerEmail || 'N/A'}</p>
        <p><span class="label">Subject:</span> ${ticket.subject}</p>
        <p><span class="label">Priority:</span> ${ticket.priority.toUpperCase()}</p>
        <p><span class="label">Category:</span> ${ticket.category || 'General'}</p>
        ${ticket.emotionalState ? `<p><span class="label">Emotional State:</span> ${ticket.emotionalState}</p>` : ''}
        ${ticket.churnRisk ? `<p><span class="label">Churn Risk:</span> ${ticket.churnRisk.toUpperCase()}</p>` : ''}
        <hr>
        <p><strong>Description:</strong></p>
        <p>${ticket.description}</p>
      </div>
      
      <p>Please review and respond to this ticket as soon as possible.</p>
    </div>
  </div>
</body>
</html>`;

    return this.sendEmail({
      to: agentEmail,
      from: this.fromEmail,
      subject,
      htmlContent,
      textContent: message
    });
  }
}

export const emailService = new EmailService();
