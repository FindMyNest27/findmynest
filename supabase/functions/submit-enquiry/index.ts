import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = 'https://vbkmfloxweczyvpfbsdh.supabase.co';
const SB_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SB_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SITE_URL = 'https://www.findmynest.co.nz';
const FROM = 'FindMyNest <noreply@findmynest.co.nz>';

// B4.2: server-side JWT auth (ADR-1) — identity derived from auth.uid(), NEVER from the request body.
// verify_jwt = true is set in supabase/config.toml. ADR-5: CORS locked to the production origin.
// ADR-6: all secrets via Deno.env.get. ALL original business logic (AI score, enquiry columns,
// branded PM email) is preserved verbatim — only auth/secrets/CORS changed.
const cors = {
  'Access-Control-Allow-Origin': SITE_URL,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

async function sendEnquiryEmail(
  pm_email: string, listing: Record<string, unknown>,
  renter_name: string, renter_email: string, renter_phone: string,
  message: string, aiScore: number, aiSummary: string, aiReasoning: string,
  aiPositives: string[], aiConcerns: string[], renterProfile: Record<string, unknown>
) {
  const scoreColor = aiScore >= 75 ? '#22c55e' : aiScore >= 50 ? '#f59e0b' : '#ef4444';
  const scoreLabel = aiScore >= 75 ? 'Strong Match' : aiScore >= 50 ? 'Possible Match' : 'Low Match';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAF0DC;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="text-align:center;margin-bottom:24px;"><h1 style="color:#3D1F0D;margin:0;font-size:1.8rem;">FindMy<span style="color:#E8724A;">Nest</span>&#8482; &#x1F95D;</h1></div>
  <div style="background:#fff;border-radius:20px;padding:28px;margin-bottom:16px;box-shadow:0 4px 16px rgba(61,31,13,.08);">
    <div style="background:#E8724A;color:#fff;border-radius:50px;padding:4px 14px;font-size:.78rem;font-weight:700;display:inline-block;margin-bottom:12px;">&#128140; NEW APPLICATION</div>
    <h2 style="color:#3D1F0D;margin:0 0 4px;">New application on your listing</h2>
    <p style="color:#6B3A1F;margin:0 0 20px;font-size:.9rem;">${listing.title} &bull; ${listing.suburb}, ${listing.city}</p>
    <div style="background:#F7F3EE;border-radius:14px;padding:16px;margin-bottom:16px;display:flex;align-items:center;gap:16px;">
      <div style="text-align:center;flex-shrink:0;"><div style="width:64px;height:64px;border-radius:50%;background:#fff;border:4px solid ${scoreColor};display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:700;color:${scoreColor};">${aiScore}</div><div style="font-size:.7rem;font-weight:700;color:${scoreColor};margin-top:4px;">${scoreLabel}</div></div>
      <div><div style="font-weight:700;color:#3D1F0D;margin-bottom:4px;">AI Compatibility Score</div><div style="font-size:.86rem;color:#6B3A1F;">${aiSummary}</div></div>
    </div>
    ${aiReasoning ? `<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:12px 14px;margin-bottom:14px;"><div style="font-size:.75rem;font-weight:700;color:#0369A1;margin-bottom:4px;">&#129302; How AI calculated this score</div><div style="font-size:.84rem;color:#0C4A6E;line-height:1.6;">${aiReasoning}</div></div>` : ''}
    ${aiPositives.length ? `<div style="margin-bottom:10px;">${aiPositives.map(p => `<span style="background:#dcfce7;color:#166534;border-radius:50px;padding:3px 10px;font-size:.78rem;margin:2px;display:inline-block;">&#10003; ${p}</span>`).join('')}</div>` : ''}
    ${aiConcerns.length ? `<div style="margin-bottom:16px;">${aiConcerns.map(c => `<span style="background:#fef2f2;color:#991b1b;border-radius:50px;padding:3px 10px;font-size:.78rem;margin:2px;display:inline-block;">&#9888; ${c}</span>`).join('')}</div>` : ''}
    <div style="border-top:1px solid #F2D4C0;padding-top:16px;margin-bottom:16px;">
      <div style="font-weight:700;color:#3D1F0D;margin-bottom:10px;">&#128100; Applicant Details</div>
      <table style="width:100%;border-collapse:collapse;font-size:.88rem;">
        <tr><td style="padding:4px 0;color:#6B3A1F;width:120px;">Name</td><td style="font-weight:600;color:#3D1F0D;">${renter_name}</td></tr>
        <tr><td style="padding:4px 0;color:#6B3A1F;">Email</td><td style="font-weight:600;color:#3D1F0D;"><a href="mailto:${renter_email}" style="color:#E8724A;">${renter_email}</a></td></tr>
        ${renter_phone ? `<tr><td style="padding:4px 0;color:#6B3A1F;">Phone</td><td style="font-weight:600;color:#3D1F0D;">${renter_phone}</td></tr>` : ''}
        ${renterProfile.budget_max ? `<tr><td style="padding:4px 0;color:#6B3A1F;">Budget</td><td style="font-weight:600;color:#3D1F0D;">$${renterProfile.budget_max}/wk</td></tr>` : ''}
        ${renterProfile.beds_needed ? `<tr><td style="padding:4px 0;color:#6B3A1F;">Beds needed</td><td style="font-weight:600;color:#3D1F0D;">${renterProfile.beds_needed} bed</td></tr>` : ''}
        ${renterProfile.pets ? `<tr><td style="padding:4px 0;color:#6B3A1F;">Pets</td><td style="font-weight:600;color:#3D1F0D;">${renterProfile.pets}</td></tr>` : ''}
        ${renterProfile.move_date ? `<tr><td style="padding:4px 0;color:#6B3A1F;">Move date</td><td style="font-weight:600;color:#3D1F0D;">${renterProfile.move_date}</td></tr>` : ''}
      </table>
    </div>
    ${message ? `<div style="background:#FAF0DC;border-radius:10px;padding:14px;margin-bottom:16px;"><div style="font-weight:700;color:#3D1F0D;margin-bottom:6px;">&#128172; Their Message</div><p style="color:#6B3A1F;margin:0;font-style:italic;line-height:1.6;">&ldquo;${message}&rdquo;</p></div>` : ''}
    <a href="mailto:${renter_email}?subject=Re: Your application on ${encodeURIComponent(String(listing.title))}" style="display:block;background:#E8724A;color:#fff;text-align:center;padding:14px;border-radius:50px;text-decoration:none;font-weight:700;font-size:1rem;margin-bottom:10px;">&#10003; Reply to ${renter_name}</a>
    <a href="${SITE_URL}" style="display:block;background:#F7F3EE;color:#3D1F0D;text-align:center;padding:12px;border-radius:50px;text-decoration:none;font-weight:600;font-size:.88rem;">View application dashboard on FindMyNest</a>
  </div>
  <p style="text-align:center;color:#A07850;font-size:.75rem;margin:0;">FindMyNest&#8482; &bull; NZ's Rental Marketplace &bull; <a href="${SITE_URL}" style="color:#E8724A;">findmynest.co.nz</a></p>
</div></body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [pm_email], reply_to: renter_email, subject: `New application ${aiScore}/100 match — ${listing.title}`, html })
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    // ADR-1: validate JWT and derive identity from auth.uid() — client-supplied identity is IGNORED.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const authClient = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Body is still read for listing_id + message, but renter identity fields are DISCARDED.
    const { listing_id, message } = await req.json();
    if (!listing_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(SB_URL, SB_SERVICE_KEY);

    // ADR-1: renter profile resolved from auth.uid(), never from the client renter_id.
    const { data: renterProfileRow } = await supabase.from('renters').select('*').eq('auth_id', user.id).single();
    if (!renterProfileRow) {
      return new Response(JSON.stringify({ error: 'Forbidden: no renter profile for this user' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const renterProfile: Record<string, unknown> = renterProfileRow;
    // Identity for display/notification derived from the verified profile + JWT, not the client body.
    const renter_name = String(renterProfile.name || renterProfile.full_name || '');
    const renter_email = String(user.email || renterProfile.email || '');
    const renter_phone = String(renterProfile.phone || '');

    const { data: listing } = await supabase.from('listings').select('*').eq('id', listing_id).single();
    if (!listing) return new Response(JSON.stringify({ error: 'Listing not found' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });

    const prompt = `You are a property management assistant for FindMyNest, a New Zealand rental marketplace.
Score this renter's suitability for the listing below. Return ONLY valid JSON.
LISTING: Title: ${listing.title}, Suburb: ${listing.suburb} ${listing.city}, Rent: $${listing.rent}/week, Type: ${listing.type}, Beds: ${listing.beds}, Baths: ${listing.baths}, Pets: ${listing.pets}, Furnished: ${listing.furnished}, Available: ${listing.avail || 'Now'}, Description: ${listing.description || 'Not provided'}
RENTER: Name: ${renter_name}, Budget max: ${renterProfile.budget_max ? '$' + renterProfile.budget_max + '/week' : 'Not specified'}, City: ${renterProfile.city || 'Not specified'}, Beds needed: ${renterProfile.beds_needed || 'Not specified'}, Pets: ${renterProfile.pets || 'No'}, Move date: ${renterProfile.move_date || 'Not specified'}, Message: ${message || 'None'}
Respond ONLY with this JSON:
{"score":<0-100>,"summary":"<one sentence verdict>","reasoning":"<2-3 sentences on how score was calculated>","positives":["<point1>","<point2>"],"concerns":["<concern1>"]}`;

    let aiScore = 70, aiSummary = 'Good potential match', aiReasoning = '';
    let aiPositives: string[] = ['Enquired directly'], aiConcerns: string[] = [];
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
      });
      const aiData = await aiRes.json();
      const text = aiData.content?.[0]?.text || '{}';
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      aiScore = Math.min(100, Math.max(0, Number(parsed.score) || 70));
      aiSummary = parsed.summary || aiSummary;
      aiReasoning = parsed.reasoning || '';
      aiPositives = parsed.positives || aiPositives;
      aiConcerns = parsed.concerns || aiConcerns;
    } catch (e) { console.error('AI error:', e); }

    const pmEmail = listing.email || '';
    const { data: enquiry, error } = await supabase.from('enquiries').insert({
      listing_id,
      renter_id: user.id,
      renter_name, renter_email,
      renter_phone: renter_phone || null,
      message: message || null,
      ai_score: aiScore, ai_summary: aiSummary, ai_reasoning: aiReasoning,
      ai_positives: aiPositives, ai_concerns: aiConcerns,
      status: 'new',
      pm_email: pmEmail,
      listing_title: String(listing.title || ''),
      listing_suburb: String(listing.suburb || ''),
      listing_city: String(listing.city || ''),
      listing_rent: Number(listing.rent || 0),
      renter_budget_max: renterProfile.budget_max as number || null,
      renter_city: renterProfile.city as string || null,
      renter_beds_needed: renterProfile.beds_needed as string || null,
      renter_pets: renterProfile.pets as string || null,
      renter_move_date: renterProfile.move_date as string || null,
      renter_interests: renterProfile.interests as string[] || null,
    }).select().single();
    if (error) throw new Error(error.message);

    if (pmEmail) {
      try {
        await sendEnquiryEmail(pmEmail, listing, renter_name, renter_email, renter_phone || '', message || '', aiScore, aiSummary, aiReasoning, aiPositives, aiConcerns, renterProfile);
      } catch (emailErr) { console.error('Email failed:', emailErr); }
    }

    return new Response(JSON.stringify({ success: true, enquiry_id: enquiry.id, ai_score: aiScore }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Enquiry error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
