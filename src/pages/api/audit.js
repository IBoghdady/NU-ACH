import { supabase } from '../../lib/supabaseClient'

let nodemailer = null
try {
  nodemailer = require('nodemailer')
} catch (e) {
  // Nodemailer will be loaded once dependencies are installed on Vercel
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const {
      userEmail = 'Unknown User',
      action = 'Unknown Action',
      category = 'General',
      details = '',
      metadata = {}
    } = req.body

    const forwarded = req.headers['x-forwarded-for']
    const ip = forwarded ? forwarded.split(',')[0].trim() : (req.socket?.remoteAddress || 'Unknown')
    const userAgent = req.headers['user-agent'] || 'Unknown'

    // Formatted Egyptian / Cairo local time
    const now = new Date()
    const cairoTimeFormatted = now.toLocaleString('en-US', {
      timeZone: 'Africa/Cairo',
      dateStyle: 'full',
      timeStyle: 'medium'
    })

    // 1. Try to record in Supabase audit_logs table
    let dbSuccess = false
    try {
      const { error: dbError } = await supabase.from('audit_logs').insert([
        {
          user_email: userEmail,
          action,
          category,
          details,
          metadata,
          ip_address: ip,
          created_at: now.toISOString()
        }
      ])
      if (!dbError) {
        dbSuccess = true
      } else {
        console.warn('Could not insert to audit_logs (table may not exist yet):', dbError.message)
      }
    } catch (dbErr) {
      console.warn('DB audit log error:', dbErr.message)
    }

    // 2. Prepare Email Notification
    const targetEmail = process.env.AUDIT_NOTIFICATION_EMAIL || 'EBoghdady@nu.edu.eg'
    const subject = `🔔 [NU-ACH Audit] ${action} - ${userEmail}`

    // Category badge color
    let badgeColor = '#4f46e5'
    if (category.toLowerCase().includes('auth')) badgeColor = '#2563eb'
    if (category.toLowerCase().includes('transact')) badgeColor = '#059669'
    if (category.toLowerCase().includes('beneficiar') || category.toLowerCase().includes('vendor')) badgeColor = '#d97706'
    if (category.toLowerCase().includes('export') || category.toLowerCase().includes('excel')) badgeColor = '#7c3aed'

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 30px; margin: 0; min-height: 100%;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #1e293b; border-radius: 12px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); padding: 24px 30px; border-bottom: 1px solid #4338ca;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #a5b4fc; font-weight: 700; margin-bottom: 6px;">
              Nile University ACH Security Audit
            </div>
            <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #ffffff;">
              Activity Alert: ${escapeHtml(action)}
            </h1>
          </div>

          <!-- Body -->
          <div style="padding: 30px;">
            <div style="margin-bottom: 20px;">
              <span style="display: inline-block; background-color: ${badgeColor}; color: #ffffff; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                ${escapeHtml(category)}
              </span>
            </div>

            <!-- Details Card -->
            <div style="background-color: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
              <div style="font-size: 13px; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">Activity Details</div>
              <div style="font-size: 15px; color: #f1f5f9; line-height: 1.6; word-break: break-word;">
                ${escapeHtml(details)}
              </div>
            </div>

            <!-- Meta Table -->
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #334155; color: #94a3b8; width: 140px; font-weight: 600;">Performed By:</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #334155; color: #38bdf8; font-weight: 700;">${escapeHtml(userEmail)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-weight: 600;">Cairo Time:</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #334155; color: #e2e8f0;">${escapeHtml(cairoTimeFormatted)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #334155; color: #94a3b8; font-weight: 600;">IP Address:</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #334155; color: #e2e8f0; font-family: monospace;">${escapeHtml(ip)}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #94a3b8; font-weight: 600;">Client:</td>
                <td style="padding: 10px 0; color: #64748b; font-size: 11px; word-break: break-all;">${escapeHtml(userAgent)}</td>
              </tr>
            </table>

          </div>

          <!-- Footer -->
          <div style="background-color: #0f172a; padding: 16px 30px; text-align: center; border-top: 1px solid #334155; font-size: 11px; color: #64748b;">
            This is an automated audit alert sent to <strong>${escapeHtml(targetEmail)}</strong>.<br/>
            Nile University ACH Payouts & Transactions Engine.
          </div>
        </div>
      </div>
    `

    // 3. Attempt Email Delivery
    let emailSent = false
    let emailProvider = null
    let emailError = null

    // Option A: Resend API (HTTP direct fetch)
    if (process.env.RESEND_API_KEY) {
      try {
        emailProvider = 'Resend'
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'NU-ACH Audit <onboarding@resend.dev>',
            to: [targetEmail],
            subject: subject,
            html: emailHtml
          })
        })
        const resendData = await resendRes.json()
        if (resendRes.ok) {
          emailSent = true
        } else {
          emailError = resendData?.message || 'Resend API returned non-200'
        }
      } catch (rErr) {
        emailError = rErr.message
      }
    }

    // Option B: Nodemailer SMTP
    if (!emailSent && nodemailer && process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        emailProvider = 'SMTP'
        const port = parseInt(process.env.SMTP_PORT || '465', 10)
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: port,
          secure: process.env.SMTP_SECURE === 'true' || port === 465,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        })

        await transporter.sendMail({
          from: process.env.EMAIL_FROM || `"NU-ACH Audit" <${process.env.SMTP_USER}>`,
          to: targetEmail,
          subject: subject,
          html: emailHtml
        })
        emailSent = true
      } catch (sErr) {
        emailError = sErr.message
      }
    }

    // Option C: Brevo API
    if (!emailSent && process.env.BREVO_API_KEY) {
      try {
        emailProvider = 'Brevo'
        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': process.env.BREVO_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sender: { name: 'NU-ACH Audit', email: process.env.EMAIL_FROM || 'audit@nu.edu.eg' },
            to: [{ email: targetEmail }],
            subject: subject,
            htmlContent: emailHtml
          })
        })
        if (brevoRes.ok) {
          emailSent = true
        } else {
          const bData = await brevoRes.json()
          emailError = bData?.message || 'Brevo API error'
        }
      } catch (bErr) {
        emailError = bErr.message
      }
    }

    return res.status(200).json({
      success: true,
      dbSuccess,
      emailSent,
      emailProvider,
      emailError,
      recipient: targetEmail
    })

  } catch (err) {
    console.error('Audit handler error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

function escapeHtml(string) {
  if (!string) return ''
  return String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
