import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = 'https://vbkmfloxweczyvpfbsdh.supabase.co';
const SB_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SB_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = 'FindMyNest <noreply@findmynest.co.nz>';

// ADR-5: CORS locked to the production origin — no wildcard.
const CORS = {
  'Access-Control-Allow-Origin': 'https://www.findmynest.co.nz',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // ADR-1: extract and validate JWT — identity is NEVER taken from the request body.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  const jwt = authHeader.replace('Bearer ', '');

  // ADR-1: auth client with the caller's JWT — used only to verify identity.
  const authClient = createClient(SB_URL, SB_ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data: { user }, error: userError } = await authClient.auth.getUser(jwt);
  if (userError || !user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  // ADR-1: service client for all privileged DB operations.
  const serviceClient = createClient(SB_URL, SB_SERVICE_KEY);

  // ADR-1: resolve renter from verified auth.uid() — NEVER from body.
  const { data: renter, error: renterError } = await serviceClient
    .from('renters')
    .select('*')
    .eq('auth_id', user.id)
    .single();

  if (renterError || !renter) {
    return new Response(
      JSON.stringify({ error: 'Forbidden: no renter profile found for this user' }),
      { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Parse body — identity fields (renter_id, renter_name, renter_email, renter_phone) are READ and DISCARDED.
    const body = await req.json();
    const { listing_id, message } = body;
    // renter_id, renter_name, renter_email, renter_phone from body are deliberately ignored.

    if (!listing_id || !message) {
      return new Response(
        JSON.stringify({ error: 'listing_id and message are required' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the listing using SERVICE_ROLE (bypasses RLS safely — caller is verified above).
    const { data: listing, error: listingError } = await serviceClient
      .from('listings')
      .select('*')
      .eq('id', listing_id)
      .single();

    if (listingError || !listing) {
      return new Response(
        JSON.stringify({ error: 'Listing not found' }),
        { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // AI-powered message summary via Anthropic (optional enhancement — errors are non-fatal).
    let aiSummary = '';
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 150,
          messages: [{
            role: 'user',
            content: `Summarise this rental enquiry in 1-2 sentences for the property manager:\n\n"${message}"`
          }]
        })
      });
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        aiSummary = aiData?.content?.[0]?.text ?? '';
      }
    } catch (_aiErr) {
      // Non-fatal — proceed without summary
    }

    // Insert enquiry using SERVICE_ROLE — identity comes from server-resolved renter, not body.
    const { data: enquiry, error: insertError } = await serviceClient
      .from('enquiries')
      .insert({
        listing_id,
        renter_id: renter.id,
        renter_auth_id: user.id,
        message,
        ai_summary: aiSummary || null
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save enquiry' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Notify property manager via Resend (if listing has a contact email).
    if (listing.contact_email || listing.pm_email) {
      const pmEmail = listing.contact_email || listing.pm_email;
      const html = `
<p>Hi,</p>
<p>You have a new enquiry from <strong>${renter.name || renter.full_name || 'a renter'}</strong> about your listing: <strong>${listing.title || listing.address || listing_id}</strong>.</p>
<blockquote style="border-left:3px solid #E8724A;padding-left:12px;color:#3D1F0D;">${message.replace(/\n/g, '<br>')}</blockquote>
${aiSummary ? `<p><em>AI summary: ${aiSummary}</em></p>` : ''}
<p>Log in to <a href="https://www.findmynest.co.nz">FindMyNest</a> to respond.</p>
<p style="font-size:12px;color:#A07850;">FindMyNest — New Zealand's Flatmate &amp; Room Finder</p>`;

      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: FROM,
            to: [pmEmail],
            subject: `New enquiry for your listing — FindMyNest`,
            html
          })
        });
      } catch (_emailErr) {
        // Non-fatal — enquiry is already saved
      }
    }

    return new Response(
      JSON.stringify({ success: true, enquiry_id: enquiry?.id }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('submit-enquiry error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
