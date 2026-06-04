import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = 'FindMyNest <noreply@findmynest.co.nz>';
const SITE_URL = 'https://www.findmynest.co.nz';
const SB_URL = 'https://vbkmfloxweczyvpfbsdh.supabase.co';
const SB_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// B4.5: signup branch REMOVED entirely (ADR-3). send-email serves ONLY recovery.
// Supabase Auth native confirmation email (branded via dashboard SMTP/template) handles signup.
// verify_jwt = false in config.toml — pre-auth function, no session exists at call time.
// ADR-5: CORS locked to the production origin — no wildcard.
const CORS = {
  'Access-Control-Allow-Origin': 'https://www.findmynest.co.nz',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { type, email } = await req.json();

    // ADR-3: send-email now serves ONLY recovery.
    // The type:'signup' branch has been REMOVED entirely.
    // Signup confirmation emails are delivered by Supabase Auth natively
    // via the dashboard-configured Resend SMTP + branded template.
    if (type !== 'recovery') {
      return new Response(
        JSON.stringify({ error: 'Unsupported email type. Only recovery is handled here.' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'email is required' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SB_URL, SB_SERVICE_KEY);

    // Link is always server-generated via admin.generateLink — client-supplied URLs are never trusted.
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: SITE_URL }
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error('generateLink error:', linkError);
      return new Response(
        JSON.stringify({ error: 'Failed to generate recovery link' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const resetLink = linkData.properties.action_link;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your FindMyNest Password</title>
</head>
<body style="margin:0;padding:0;background:#FAF0DC;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF0DC;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#E8724A,#C85A2E);padding:32px 40px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">🏡 FindMyNest</div>
              <div style="font-size:13px;color:rgba(255,255,255,0.85);margin-top:4px;">New Zealand's Flatmate & Room Finder</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#3D1F0D;">Reset your password</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#6B3A1F;line-height:1.6;">
                We received a request to reset the password for your FindMyNest account. Click the button below to choose a new password.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td>
                    <a href="${resetLink}" style="display:inline-block;background:linear-gradient(135deg,#E8724A,#C85A2E);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:50px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#A07850;line-height:1.5;">
                If you didn't request a password reset, you can safely ignore this email — your password won't change.
              </p>
              <p style="margin:0;font-size:13px;color:#A07850;line-height:1.5;">
                This link will expire shortly for your security.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#FAF0DC;padding:20px 40px;text-align:center;border-top:1px solid #E8D5B0;">
              <p style="margin:0;font-size:12px;color:#A07850;">
                &copy; ${new Date().getFullYear()} FindMyNest &mdash; New Zealand's Flatmate &amp; Room Finder
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: 'Reset your FindMyNest password',
        html
      })
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      console.error('Resend error:', err);
      return new Response(
        JSON.stringify({ error: 'Failed to send email' }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('send-email error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
