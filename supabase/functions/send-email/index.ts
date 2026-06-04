import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = 'FindMyNest <noreply@findmynest.co.nz>';
const SITE_URL = 'https://www.findmynest.co.nz';
const SB_URL = 'https://vbkmfloxweczyvpfbsdh.supabase.co';
const SB_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// B4.5 (ADR-3): the type:'signup' branch and its client-supplied confirmationUrl are REMOVED.
// send-email serves ONLY recovery, whose link is generated server-side via admin.generateLink
// (so a client-supplied URL can never be relayed). Signup confirmation is now delivered by
// Supabase Auth natively, branded via the dashboard Resend SMTP + template.
// verify_jwt = false in supabase/config.toml — this is a pre-auth flow. ADR-5: CORS locked. ADR-6: env secrets.
const corsHeaders = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { type, email } = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: 'Missing email' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ADR-3: only recovery is handled here. Signup is delivered by Supabase Auth's native email.
    if (type !== 'recovery') {
      return new Response(JSON.stringify({ error: 'Unsupported type. Signup confirmation is handled by Supabase Auth.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Recovery link is ALWAYS generated server-side via the Admin API — never trust a client URL.
    let resetLink = SITE_URL;
    if (!SB_SERVICE_KEY) {
      return new Response(JSON.stringify({ error: 'Server not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    try {
      const supabase = createClient(SB_URL, SB_SERVICE_KEY);
      const { data, error } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email: email,
        options: { redirectTo: SITE_URL }
      });
      if (!error && data?.properties?.action_link) {
        resetLink = data.properties.action_link;
      } else if (error) {
        console.error('generateLink error:', error);
        return new Response(JSON.stringify({ error: 'Failed to generate recovery link' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    } catch (e) {
      console.error('generateLink error:', e);
      return new Response(JSON.stringify({ error: 'Failed to generate recovery link' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const subject = 'Reset your FindMyNest password 🔑';
    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px 24px;background:#FAF0DC;">
        <h1 style="color:#3D1F0D;text-align:center;">FindMy<span style="color:#E8724A;">Nest</span>™ 🥝</h1>
        <div style="background:#fff;border-radius:20px;padding:32px;">
          <h2 style="color:#3D1F0D;">Reset your password</h2>
          <p style="color:#6B3A1F;line-height:1.7;">We received a request to reset your FindMyNest password. Click the button below to set a new one.</p>
          <div style="text-align:center;margin:32px 0;">
            <a href="${resetLink}" style="background:#E8724A;color:#fff;padding:16px 40px;border-radius:50px;text-decoration:none;font-weight:700;font-size:1rem;display:inline-block;">Reset my password 🔑</a>
          </div>
          <p style="color:#A07850;font-size:.85rem;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        </div>
        <p style="color:#A07850;font-size:.8rem;text-align:center;margin-top:24px;">FindMyNest™ · NZ's Rental Marketplace · <a href="${SITE_URL}" style="color:#E8724A;">findmynest.co.nz</a></p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [email], subject, html })
    });

    const data = await res.json();
    console.log('Resend response:', JSON.stringify(data));

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, id: data.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Function error:', (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
