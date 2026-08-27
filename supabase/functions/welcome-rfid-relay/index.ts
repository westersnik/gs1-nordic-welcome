/**
 * Supabase Edge Function: welcome-rfid-relay
 *
 * Converts Keonn/AdvanReader tag reads into event-scoped welcome scans.
 * The database function verifies the active reader, allocated number range,
 * guest assignment and duplicate scan before publishing data to the screen.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const EVENT_KEY = Deno.env.get('RFID_EVENT_KEY') ?? 'gs1nordic2026';

type RawTag = { epc: string; readerId: string };

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...extraHeaders, 'Content-Type': 'application/json' },
  });
}

function parseTags(body: any): RawTag[] {
  const defaultReader = String(body?.devid ?? body?.reader_id ?? 'advanreader');
  if (typeof body?.epc === 'string') {
    return [{ epc: body.epc.toUpperCase(), readerId: defaultReader }];
  }
  if (Array.isArray(body?.epc_list)) {
    return body.epc_list.map((epc: string) => ({ epc: String(epc).toUpperCase(), readerId: defaultReader }));
  }
  if (Array.isArray(body?.tags)) {
    return body.tags.map((tag: any) => ({
      epc: String(tag?.epc ?? tag?.EPC ?? '').toUpperCase(),
      readerId: String(body?.devid ?? tag?.reader_id ?? defaultReader),
    }));
  }
  if (Array.isArray(body?.reads)) {
    return body.reads.map((read: any) => ({
      epc: String(read?.epc ?? read?.EPC ?? '').toUpperCase(),
      readerId: String(body?.devid ?? read?.reader_id ?? defaultReader),
    }));
  }
  return [];
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Event-Key',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, corsHeaders);

  const providedKey = req.headers.get('X-Event-Key');
  if (!EVENT_KEY || providedKey !== EVENT_KEY) {
    return json({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400, corsHeaders);
  }

  const tags = parseTags(body).filter((tag) => tag.epc.length > 0);
  if (!tags.length) return json({ success: true, processed: 0, message: 'No tags in payload' }, 200, corsHeaders);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const results: Array<Record<string, unknown>> = [];
  let recorded = 0;
  let duplicates = 0;
  let cooldowns = 0;
  let skipped = 0;

  for (const tag of tags) {
    const { data, error } = await supabase.rpc('record_welcome_scan', {
      p_reader: tag.readerId.trim(),
      p_epc: tag.epc.trim(),
    });

    if (error) {
      skipped++;
      const message = error.message || 'Tag could not be processed';
      await supabase.from('welcome_feedback').insert({ epc: tag.epc, reader_id: tag.readerId, reason: message });
      results.push({ epc: tag.epc, reader_id: tag.readerId, status: 'skipped', reason: message });
      continue;
    }

    if (data?.status === 'duplicate') duplicates++;
    else if (data?.status === 'cooldown') cooldowns++;
    else recorded++;
    results.push({ epc: tag.epc, reader_id: tag.readerId, ...data });
  }

  return json({
    success: true,
    processed: tags.length,
    recorded,
    duplicates,
    cooldowns,
    skipped,
    reader_profile: { inventory_session: 2, search_mode: 'single_target' },
    results,
  }, 200, corsHeaders);
});
