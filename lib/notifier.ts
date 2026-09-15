import { Job } from '../types/job';

const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

/**
 * Send an email notification using Resend API directly.
 */
export async function sendEmailNotification(job: Partial<Job>, score: number, recipientEmail: string) {
    if (!RESEND_API_KEY) {
        console.warn('RESEND_API_KEY missing. Skipping email.');
        return false;
    }

    const percentage = (score * 100).toFixed(1);
    const subject = `🔥 ${percentage}% Match – ${job.title} – ${job.location || 'Remote/Unknown'}`;

    const htmlContent = `
    <h2>🔥 High Match Alert: ${percentage}%</h2>
    <p><strong>Job Title:</strong> ${job.title}</p>
    <p><strong>Company:</strong> ${job.company}</p>
    <p><strong>Location:</strong> ${job.location || 'Not specified'}</p>
    <br/>
    <p><strong>Snippet:</strong><br/> ${job.description ? job.description.substring(0, 300) : ''}...</p>
    <br/>
    <a href="${job.url}" style="padding: 10px 20px; background-color: #0070f3; color: white; text-decoration: none; border-radius: 5px;">Apply Now</a>
  `;

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: 'AI Recruiter <onboarding@resend.dev>', // Update for production domains
                to: recipientEmail,
                subject: subject,
                html: htmlContent
            })
        });

        if (!res.ok) {
            console.error('Resend Error:', await res.text());
            return false;
        }
        return true;
    } catch (error) {
        console.error('Email send failed:', error);
        return false;
    }
}

/**
 * Send a Telegram message via standard Telegram Bot API.
 */
export async function sendTelegramNotification(job: Partial<Job>, score: number, chatId: string = TELEGRAM_CHAT_ID) {
    if (!TELEGRAM_BOT_TOKEN || !chatId) {
        console.warn('Telegram token or chat ID missing. Skipping Telegram alert.');
        return false;
    }

    const percentage = (score * 100).toFixed(1);
    const text = `🔥 NEW HIGH MATCH (${percentage}%)\n\n💼 Job: ${job.title}\n🏢 Company: ${job.company}\n📍 Location: ${job.location || 'N/A'}\n\n🔗 Apply: ${job.url}`;

    try {
        const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML' // Or Markdown
            })
        });

        if (!res.ok) {
            console.error('Telegram Error:', await res.text());
            return false;
        }
        return true;
    } catch (error) {
        console.error('Telegram send failed:', error);
        return false;
    }
}
