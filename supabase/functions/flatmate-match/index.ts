import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = 'https://vbkmfloxweczyvpfbsdh.supabase.co';
const SB_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SB_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GROQ_KEY = Deno.env.get('GROQ_API_KEY') ?? '';

// B4.1: server-side JWT auth (ADR-1) + server-side room re-fetch (ADR-2).
// renter is resolved from flatmate_profiles via the JWT email; room is re-fetched from room_listings
// by room_id. NEITHER side of the prompt comes from the client body anymore.
// verify_jwt = true in supabase/config.toml. ADR-5: CORS locked. ADR-6: GROQ key via env.
// The Groq prompt + output contract are preserved verbatim from the original.
const cors = {
  'Access-Control-Allow-Origin': 'https://www.findmynest.co.nz',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // ADR-1: validate JWT — renter identity is derived from it, never from the body.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const authClient = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // ADR-2: client now sends only { room_id }. The client-supplied renter/room objects are IGNORED.
    const { room_id } = await req.json();
    if (!room_id) {
      return new Response(JSON.stringify({ error: 'room_id is required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const service = createClient(SB_URL, SB_SERVICE_KEY);

    // ADR-1: renter profile from flatmate_profiles keyed by the JWT email (mirrors the client lookup,
    // but the email now comes from the validated token, not the request body).
    const { data: renter } = await service.from('flatmate_profiles').select('*').eq('email', user.email).single();
    if (!renter) {
      return new Response(JSON.stringify({ error: 'Forbidden: no flatmate profile for this user' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // ADR-2: room re-fetched server-side from room_listings by id — never trust a client room object.
    const { data: room } = await service.from('room_listings').select('*').eq('id', room_id).single();
    if (!room) {
      return new Response(JSON.stringify({ error: 'Room not found' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const prompt = `You are a flatmate compatibility expert. Score how well this person matches this room listing on a scale of 0-100.\n\nRENTER PROFILE:\n- Name: ${renter.name}\n- Age: ${renter.age || 'not specified'}\n- Gender: ${renter.gender || 'not specified'}\n- Occupation: ${renter.occupation || 'not specified'}\n- Budget: $${renter.budget_min || 0}-$${renter.budget_max}/week\n- Move date: ${renter.move_date || 'flexible'}\n- Has pets: ${renter.has_pets || 'No'}\n- Smoker: ${renter.smoker || 'No'}\n- Couple: ${renter.couple || 'No'}\n- About me: ${renter.about_me || 'not provided'}\n- Ideal flatmates: ${renter.ideal_flatmates || 'not provided'}\n\nROOM LISTING:\n- Title: ${room.title}\n- Location: ${room.suburb}, ${room.city}\n- Rent: $${room.rent_per_week}/week\n- Bills included: ${room.bills_included || 'No'}\n- Room type: ${room.room_type || 'not specified'}\n- Furnished: ${room.furnished || 'Unfurnished'}\n- Total rooms in house: ${room.total_rooms || 'not specified'}\n- Current flatmates: ${room.current_flatmates || 'not specified'}\n- Preferred flatmate gender: ${room.flatmate_gender || 'Any'}\n- Age range preferred: ${room.flatmate_age_min || 'any'}-${room.flatmate_age_max || 'any'}\n- Pets OK: ${room.pets_ok || 'No'}\n- Smoking OK: ${room.smoking_ok || 'No'}\n- Couples OK: ${room.couples_ok || 'No'}\n- Students OK: ${room.students_ok || 'Yes'}\n- House vibe: ${room.house_vibe || 'not specified'}\n- About flatmates: ${room.about_flatmates || 'not provided'}\n\nRespond ONLY with valid JSON in this exact format, no other text:\n{\n  "score": 85,\n  "summary": "One sentence overview of the match",\n  "positives": ["reason 1", "reason 2", "reason 3"],\n  "concerns": ["concern 1"],\n  "verdict": "One punchy sentence verdict"\n}`;
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
      body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 400 })
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const result = JSON.parse(jsonMatch[0]);
    return new Response(JSON.stringify(result), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
