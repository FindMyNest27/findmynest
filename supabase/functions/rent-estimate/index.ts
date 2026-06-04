import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GROQ_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// B4.3: stays a PUBLIC discovery endpoint, but verify_jwt = true in supabase/config.toml means the
// gateway now requires a valid project JWT (the client sends the anon key). No user-level identity is
// derived here. ADR-5: CORS locked to the production origin. ADR-6: GROQ key via env.
// All query/columns (rent,type,beds), the prompt, and the response shape are preserved verbatim.
const cors = {
  'Access-Control-Allow-Origin': 'https://www.findmynest.co.nz',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { suburb, city, type, park, pets, furnished, beds, baths } = await req.json();
    if (!city) return new Response(JSON.stringify({ error: 'City required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    let filter = `?status=eq.active&city=eq.${encodeURIComponent(city)}`;
    if (suburb) filter += `&suburb=eq.${encodeURIComponent(suburb)}`;
    if (type && type !== '') filter += `&type=eq.${encodeURIComponent(type)}`;
    filter += '&select=rent,type,beds';
    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/listings${filter}`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const listings = await dbRes.json();
    let ownData = null;
    if (listings && listings.length > 0) {
      const rents = listings.map((l: any) => parseFloat(l.rent)).filter((r: number) => r > 0);
      const avg = Math.round(rents.reduce((a: number, b: number) => a + b, 0) / rents.length);
      ownData = { count: listings.length, avg, min: Math.min(...rents), max: Math.max(...rents) };
    }
    const location = suburb ? `${suburb}, ${city}` : city;
    const typeStr = type ? ` for ${type}s` : '';
    const extra = [beds && `${beds} bedroom`, baths && `${baths} bathroom`, park && park !== 'None' && `parking: ${park}`, pets === 'Yes' && 'pets allowed', furnished && furnished !== 'Unfurnished' && furnished].filter(Boolean).join(', ');
    const prompt = `You are a New Zealand rental market expert. Provide a brief factual rental market overview for ${location}, New Zealand${typeStr}${extra ? ` (${extra})` : ''}. Include: typical weekly rent range, what drives pricing (amenities, transport, schools, lifestyle), whether affordable/mid-range/premium. Do NOT include pricing tips or landlord advice. Facts only. Under 80 words.`;
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
      body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 180 })
    });
    const groqData = await groqRes.json();
    const insight = groqData?.choices?.[0]?.message?.content?.trim() ?? '';
    return new Response(JSON.stringify({ ownData, insight, location }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
