import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [migration, config, screen, relay] = await Promise.all([
  read('supabase/migrations/20260813_welcome_events.sql'),
  read('konfigurasjon.html'),
  read('storskjerm.html'),
  read('supabase/functions/welcome-rfid-relay/index.ts'),
]);

assert.match(migration, /welcome_tag_batches/, 'Welcome batches must be separate from the legacy product model');
assert.match(migration, /welcome_events/, 'Welcome events must support multiple event sessions');
assert.match(migration, /welcome_event_tags/, 'Welcome events must reserve individual physical RFID tags');
assert.match(migration, /series_start INT NOT NULL/, 'Welcome events must retain numbered series');
assert.match(migration, /series_end INT NOT NULL/, 'Welcome events must retain numbered series end');
assert.match(migration, /welcome_one_active_reader_uniq/, 'A reader may only power one active welcome event');
assert.match(migration, /UPDATE welcome_event_tags\s+SET status = 'released'/, 'Closing an event must release unused tags');
assert.match(migration, /WHERE event_id = p_event AND status = 'available'/, 'Only never-assigned tags may be released');
assert.match(migration, /name TEXT NOT NULL/, 'Guest names must be persisted');
assert.match(migration, /company TEXT/, 'Guest companies must be persisted');

assert.match(config, /Opprett arrangement/, 'Configuration must create events');
assert.match(config, /RFID-TAG/, 'Configuration must support tag assignment');
assert.match(config, /Navn/, 'Configuration must request a guest name');
assert.match(config, /Selskapsnavn/, 'Configuration must request a company');
assert.match(config, /create_welcome_event/, 'Configuration must use the welcome event creation RPC');
assert.match(config, /assign_welcome_guest/, 'Configuration must use the welcome guest assignment RPC');
assert.match(config, /close_welcome_event/, 'Configuration must use the welcome closure RPC');

assert.match(screen, /Velkommen til vår stand!/, 'Screen must contain the required greeting');
assert.match(screen, /welcome_scans/, 'Screen must receive the event-scoped welcome feed');
assert.match(screen, /guest-name/, 'Screen must show the guest name');
assert.match(screen, /guest-company/, 'Screen must show the guest company');

assert.match(relay, /record_welcome_scan/, 'Welcome relay must validate scans through the database');
assert.match(relay, /providedKey !== EVENT_KEY/, 'Welcome relay must reject missing or invalid reader secrets');
assert.match(relay, /parseTags/, 'Welcome relay must accept Keonn payload variants');

function assertInlineScriptsCompile(source, label) {
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(script => script.trim());
  assert.ok(scripts.length > 0, `${label} must contain an inline script`);
  scripts.forEach((script, index) => {
    assert.doesNotThrow(() => new Function(script), `${label} inline script ${index + 1} must compile`);
  });
}

assertInlineScriptsCompile(config, 'Configuration page');
assertInlineScriptsCompile(screen, 'Welcome screen');

console.log('Welcome multi-event regression checks passed.');
