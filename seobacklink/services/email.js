const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const FROM = process.env.EMAIL_FROM || 'SeoBacklink <hello@seobacklink.io>';
const BASE = process.env.BASE_URL || 'https://seobacklink.io';

async function sendWelcome(email, name) {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Welcome to SeoBacklink — your first article is waiting',
    html: `<p>Hi ${name},</p>
<p>Welcome to SeoBacklink! You're on the free plan. Head to your <a href="${BASE}/dashboard">dashboard</a> to generate your first AI article.</p>
<p>Upgrade anytime at <a href="${BASE}/pricing">pricing</a> to unlock more articles and advanced features.</p>
<p>— The SeoBacklink Team</p>`,
  });
}

async function sendPasswordReset(email, token) {
  const url = `${BASE}/reset-password?token=${token}`;
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Reset your SeoBacklink password',
    html: `<p>Click the link below to reset your password. This link expires in 1 hour.</p>
<p><a href="${url}">${url}</a></p>
<p>If you didn't request this, ignore this email.</p>`,
  });
}

async function sendArticleReady(email, name, articleTitle, articleId) {
  const url = `${BASE}/articles/${articleId}`;
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `Your article is ready: "${articleTitle}"`,
    html: `<p>Hi ${name},</p>
<p>Your AI article has been generated and is ready to use:</p>
<p><strong>${articleTitle}</strong></p>
<p><a href="${url}">View and export your article →</a></p>`,
  });
}

module.exports = { sendWelcome, sendPasswordReset, sendArticleReady };
