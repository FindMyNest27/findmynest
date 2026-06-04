import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = 'https://vbkmfloxweczyvpfbsdh.supabase.co';
const SB_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';

// ADR-5: CORS locked to the production origin — no wildcard.
const CORS = {
  'Access-Control-Allow-Origin': 'https://www.findmynest.co.nz',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// B4.3: verify_jwt = true is set in supabase/config.toml — the gateway validates the JWT.
// ADR-3/4: verify_jwt = true is set in config.toml — the gateway validates the JWT.
// This function is public (accepts anon key JWT); no user-level identity check is performed.
// No getUser() call here — rent-estimate is intentionally public for the discovery flow.

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();
    const { suburb, city, type, park, pets, furnished, beds, baths } = body;

    if (!city) {
      return new Response(
        JSON.stringify({ error: 'city is required' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      );
    }

    const serviceClient = createClient(SB_URL, SB_SERVICE_KEY);

    // Query FindMyNest listings for comparable properties in the target area.
    let query = serviceClient
      .from('listings')
      .select('price, suburb, city, property_type, bedrooms, bathrooms, parking, pets_allowed, furnished')
      .eq('status', 'active')
      .ilike('city', `%${city}%`);

    if (suburb) query = query.ilike('suburb', `%${suburb}%`);
    if (type) query = query.eq('property_type', type);
    if (beds) query = query.eq('bedrooms', parseInt(beds) || beds);

    const { data: listings } = await query.limit(50);

    let ownData = null;
    if (listings && listings.length > 0) {
      const prices = listings.map((l: { price: number }) => l.price).filter(Boolean);
      if (prices.length > 0) {
        const avg = Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length);
        ownData = {
          count: prices.length,
          avg,
          min: Math.min(...prices),
          max: Math.max(...prices)
        };
      }
    }

    // Build location label for response.
    const locationLabel = suburb ? `${suburb}, ${city}` : city;

    // Groq LLM — market insight narrative.
    const prompt = [
      `You are a New Zealand rental market expert. Provide a concise 2-3 sentence market insight for:`,
      `Location: ${locationLabel}`,
      type ? `Property type: ${type}` : '',
      beds ? `Bedrooms: ${beds}` : '',
      baths ? `Bathrooms: ${baths}` : '',
      park ? `Parking: ${park}` : '',
      pets ? `Pets: ${pets}` : '',
      furnished ? `Furnished: ${furnished}` : '',
      ownData ? `FindMyNest data: ${ownData.count} listings, avg $${ownData.avg}/week, range $${ownData.min}–$${ownData.max}/week.` : 'No FindMyNest listings found for this area yet.',
      `Give a weekly rent estimate range and brief commentary on the NZ rental market in this area. Be concise and factual.`
    ].filter(Boolean).join('\n');

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.4
      })
    });

    let insight = '';
    if (groqRes.ok) {
      const groqData = await groqRes.json();
      insight = groqData?.choices?.[0]?.message?.content ?? '';
    } else {
      const errText = await groqRes.text();
      console.error('Groq error:', errText);
    }

    return new Response(
      JSON.stringify({ location: locationLabel, ownData, insight }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('rent-estimate error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );
  }
});
