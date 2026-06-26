import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import nodemailer from 'npm:nodemailer@6';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { to_emails, participant_name, team_name, domain, goal_desc, actual_value, goal_note } = await req.json();

    const recipients: string[] = Array.isArray(to_emails)
      ? to_emails.filter((e: string) => typeof e === 'string' && e.includes('@'))
      : [];

    if (!recipients.length) {
      return new Response(JSON.stringify({ error: 'No valid recipients in to_emails' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const gmailUser = Deno.env.get('GMAIL_USER');
    const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD');

    if (!gmailUser || !gmailPass) {
      console.error('[send-goal-email] Gmail credentials not configured');
      return new Response(JSON.stringify({ error: 'Email not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
    });

    const subject = participant_name
      ? `Goal Achieved — ${participant_name}: ${goal_desc}`
      : `Goal Achieved: ${goal_desc}`;

    await transporter.sendMail({
      from: `"Team ABA" <${gmailUser}>`,
      to: recipients.join(', '),
      subject,
      html: buildHtml({ participant_name, team_name, domain, goal_desc, actual_value, goal_note }),
    });

    return new Response(JSON.stringify({ ok: true, sent_to: recipients.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-goal-email]', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function buildHtml({ participant_name, team_name, domain, goal_desc, actual_value, goal_note }: {
  participant_name: string; team_name: string;
  domain: string; goal_desc: string; actual_value: string; goal_note: string;
}) {
  const esc = (s: string) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a2b3c;">
  <h2 style="color:#1a5c9e;margin-bottom:4px;">Goal Achieved</h2>
  ${participant_name ? `
  <p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#003344;">
    ${esc(participant_name)}${team_name ? `<span style="font-size:13px;font-weight:400;color:#669;margin-left:10px;">${esc(team_name)}</span>` : ''}
  </p>` : '<div style="margin-bottom:20px;"></div>'}
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:8px 0;color:#666;width:140px;vertical-align:top;">Behavior / Domain</td>
      <td style="padding:8px 0;font-weight:600;">${esc(domain)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#666;vertical-align:top;">Goal</td>
      <td style="padding:8px 0;font-weight:600;">${esc(goal_desc)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#666;vertical-align:top;">Achieved value</td>
      <td style="padding:8px 0;font-weight:600;color:#00884a;">${esc(actual_value)}</td>
    </tr>
    ${goal_note ? `<tr>
      <td style="padding:8px 0;color:#666;vertical-align:top;">Note</td>
      <td style="padding:8px 0;font-style:italic;color:#4a6a80;">${esc(goal_note)}</td>
    </tr>` : ''}
  </table>
  <p style="margin-top:28px;padding-top:16px;border-top:1px solid #e0e8f0;color:#999;font-size:12px;">
    Sent by Team ABA Behavioral Performance Dashboard
  </p>
</body>
</html>`;
}
