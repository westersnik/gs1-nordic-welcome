import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [migration, cooldown, config, screen, relay, readme] = await Promise.all([
  read('supabase/migrations/20260813_welcome_events.sql'),
  read('supabase/migrations/20260815_rfid_cooldown.sql'),
  read('konfigurasjon.html'),
  read('storskjerm.html'),
  read('supabase/functions/welcome-rfid-relay/index.ts'),
  read('README.md'),
]);

assert.match(migration, /CREATE TABLE IF NOT EXISTS welcome_events/, 'Welcome events table must exist');
assert.match(migration, /CREATE TABLE IF NOT EXISTS welcome_event_tags/, 'Event tag allocations must exist');
assert.match(migration, /CREATE TABLE IF NOT EXISTS welcome_guests/, 'Guest assignment table must exist');
assert.match(migration, /CREATE TABLE IF NOT EXISTS welcome_scans/, 'Realtime welcome scan table must exist');
assert.match(migration, /welcome_one_active_reader_uniq/, 'One reader must have one active welcome event');
assert.match(migration, /status IN \('available', 'assigned', 'welcomed', 'released'\)/, 'Tag lifecycle must retain available, assigned, welcomed and released states');
assert.match(migration, /create_welcome_event/, 'Event creation must be server-side');
assert.match(migration, /assign_welcome_guest/, 'Guest assignment must be server-side');
assert.match(migration, /record_welcome_scan/, 'RFID scans must be validated server-side');
assert.match(migration, /UNIQUE \(event_tag_id\)/, 'One assigned tag may emit one welcome scan per event');
assert.match(migration, /ALTER PUBLICATION supabase_realtime ADD TABLE welcome_scans/, 'Welcome scans must be published to Realtime');
assert.match(cooldown, /DROP CONSTRAINT IF EXISTS welcome_scans_event_tag_id_key/, 'The permanent scan lock must be replaced by a cooldown');
assert.match(cooldown, /interval '60 minutes'/, 'Welcome scans must be suppressed for 60 minutes');
assert.match(cooldown, /reader_session SMALLINT NOT NULL DEFAULT 2/, 'Reader profile must default to Session 2');
assert.match(cooldown, /'status', 'cooldown'/, 'Cooldown scans must be reported without creating a screen event');

assert.match(config, /Registrer gjest/, 'Configuration must expose guest registration');
assert.match(config, /ID-nummer på tagg/, 'Configuration must request a physical tag number');
assert.match(config, /Selskapsnavn/, 'Configuration must collect company');
assert.match(config, /create_welcome_event/, 'Configuration must create welcome events');
assert.match(config, /assign_welcome_guest/, 'Configuration must assign guests through the server function');
assert.match(config, /close_welcome_event/, 'Configuration must close welcome events');
assert.match(config, /storskjerm\.html\?event=/, 'Configuration must produce scoped screen links');

assert.match(screen, /Velkommen til vår stand!/, 'Screen must display the agreed welcome greeting');
assert.match(screen, /guest_name/, 'Screen must render the guest name');
assert.match(screen, /guest_company/, 'Screen must render the guest company');
assert.match(screen, /welcome_scans/, 'Screen must subscribe to welcome scans');
assert.match(screen, /EVENT_REFERENCE/, 'Screen must be event-scoped');
assert.match(screen, /EVENT_REFERENCE\.toLowerCase\(\) === 'demo'/, 'Screen must support the demo alias');

assert.match(relay, /welcome-rfid-relay/, 'Dedicated RFID relay must exist');
assert.match(relay, /providedKey !== EVENT_KEY/, 'RFID relay must require the event key');
assert.match(relay, /record_welcome_scan/, 'RFID relay must call the database validator');
assert.match(relay, /welcome_feedback/, 'Rejected reads must be retained for diagnostics');
assert.match(relay, /cooldowns/, 'Relay must count suppressed repeated reads separately');
assert.match(relay, /inventory_session: 2/, 'Relay must return the Session 2 reader profile');
assert.match(readme, /Event Welcome/, 'README must describe the welcome product');

function inlineScripts(source) {
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => script.trim());
}

for (const [label, source] of [['configuration', config], ['screen', screen]]) {
  const scripts = inlineScripts(source);
  assert.ok(scripts.length > 0, `${label} must have an inline script`);
  scripts.forEach((script, index) => assert.doesNotThrow(() => new Function(script), `${label} inline script ${index + 1} must compile`));
}

console.log('Event Welcome flow regression checks passed.');
