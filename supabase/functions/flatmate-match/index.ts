import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = 'https://vbkmfloxweczyvpfbsdh.supabase.co';
const SB_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SB_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';

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
    // Parse body — client sends { room_id } only.
    // The client-supplied 'renter' / 'renter_id' body fields are READ and DISCARDED.
    const body = await req.json();
    const { room_id } = body;
    // body.renter and body.renter_id are deliberately ignored.

    if (!room_id) {
      return new Response(
        JSON.stringify({ error: 'room_id is required' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // ADR-2: re-fetch room from listings by id — NEVER trust the client-supplied room object.
    const { data: room, error: roomError } = await serviceClient
      .from('listings')
      .select('*')
      .eq('id', room_id)
      .single();

    if (roomError || !room) {
      return new Response(
        JSON.stringify({ error: 'Room not found' }),
        { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    // Build prompt from SERVER-fetched renter + room.
    // Neither side comes from the client body — ADR-1 + ADR-2 guarantee this.
    const prompt = `You are a NZ flatmate compatibility expert. Assess compatibility between this renter and room listing.

RENTER PROFILE (from database):
Name: ${renter.name || renter.full_name || 'Not specified'}
Age: ${renter.age || 'Not specified'}
Budget (weekly): $${renter.budget_min || '?'}–$${renter.budget_max || '?'}
Occupation: ${renter.occupation || 'Not specified'}
Lifestyle: ${renter.lifestyle || 'Not specified'}
Pets: ${renter.has_pets ? 'Yes' : 'No'}
Smoker: ${renter.is_smoker ? 'Yes' : 'No'}
Move-in date: ${renter.move_in_date || 'Flexible'}

ROOM LISTING (from database):
Title: ${room.title || 'Unnamed listing'}
Location: ${room.suburb || ''}, ${room.city || ''}
Rent: $${room.price || '?'}/week
Type: ${room.property_type || room.type || 'Not specified'}
Bedrooms: ${room.bedrooms || 'Not specified'}
Bathrooms: ${room.bathrooms || 'Not specified'}
Furnished: ${room.furnished || 'Not specified'}
Parking: ${room.parking || 'Not specified'}
Pets allowed: ${room.pets_allowed ? 'Yes' : 'No'}
Smoking allowed: ${room.smoking_allowed ? 'Yes' : 'No'}
Available from: ${room.available_from || 'Not specified'}
Description: ${room.description || 'No description provided'}

Respond with a JSON object containing:
- score: number 0-100 (compatibility percentage)
- summary: string (1-2 sentences overall assessment)
- verdict: string ("Great match", "Good potential", "Some concerns", or "Not recommended")
- positives: string[] (up to 3 key compatibility strengths)
- concerns: string[] (up to 3 key concerns or mismatches)

Respond ONLY with valid JSON, no markdown.`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.3
      })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('Groq error:', errText);
      return new Response(
        JSON.stringify({ error: 'AI service unavailable. Please try again.' }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const groqData = await groqRes.json();
    const rawContent = groqData?.choices?.[0]?.message?.content ?? '{}';

    let result;
    try {
      result = JSON.parse(rawContent);
    } catch {
      // Groq occasionally returns markdown-wrapped JSON — strip fences.
      const stripped = rawContent.replace(/```(?:json)?\n?/g, '').trim();
      result = JSON.parse(stripped);
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('flatmate-match error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
