-- RFID repeat protection: retain every eligible arrival while suppressing repeats for 60 minutes.
BEGIN;

-- The earlier per-event unique key made a tag ineligible forever. A time index supports the
-- intended cooldown while preserving a complete arrival history.
ALTER TABLE welcome_scans
  DROP CONSTRAINT IF EXISTS welcome_scans_event_tag_id_key;

CREATE INDEX IF NOT EXISTS welcome_scans_event_tag_time_idx
  ON welcome_scans(event_tag_id, scanned_at DESC);

ALTER TABLE welcome_events
  ADD COLUMN IF NOT EXISTS reader_session SMALLINT NOT NULL DEFAULT 2
    CHECK (reader_session BETWEEN 0 AND 3);

CREATE OR REPLACE FUNCTION record_welcome_scan(
  p_reader TEXT,
  p_epc TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event welcome_events%ROWTYPE;
  v_tag_id BIGINT;
  v_event_tag welcome_event_tags%ROWTYPE;
  v_guest welcome_guests%ROWTYPE;
  v_latest_scan welcome_scans%ROWTYPE;
  v_scan_id BIGINT;
  v_cooldown_until TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_event
  FROM welcome_events
  WHERE reader_id = btrim(p_reader) AND status = 'active';

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'No active welcome event for this RFID reader';
  END IF;

  SELECT id INTO v_tag_id
  FROM beers
  WHERE upper(epc) = upper(btrim(p_epc));

  IF v_tag_id IS NULL THEN
    RAISE EXCEPTION 'RFID tag is not in the tag catalogue';
  END IF;

  SELECT * INTO v_event_tag
  FROM welcome_event_tags
  WHERE event_id = v_event.id AND tag_id = v_tag_id
  FOR UPDATE;

  IF v_event_tag.id IS NULL THEN
    RAISE EXCEPTION 'RFID tag is not allocated to the active welcome event';
  END IF;

  SELECT * INTO v_guest
  FROM welcome_guests
  WHERE event_tag_id = v_event_tag.id;

  IF v_guest.id IS NULL THEN
    RAISE EXCEPTION 'RFID tag is not assigned to a guest';
  END IF;

  SELECT * INTO v_latest_scan
  FROM welcome_scans
  WHERE event_tag_id = v_event_tag.id
  ORDER BY scanned_at DESC
  LIMIT 1;

  IF v_latest_scan.id IS NOT NULL
     AND v_latest_scan.scanned_at > now() - interval '60 minutes' THEN
    v_cooldown_until := v_latest_scan.scanned_at + interval '60 minutes';
    UPDATE welcome_guests
    SET last_seen_at = now()
    WHERE id = v_guest.id;

    RETURN jsonb_build_object(
      'status', 'cooldown',
      'event_id', v_event.id,
      'guest_name', v_guest.name,
      'guest_company', v_guest.company,
      'cooldown_until', v_cooldown_until,
      'remaining_seconds', GREATEST(0, floor(extract(epoch FROM (v_cooldown_until - now())))::INT)
    );
  END IF;

  INSERT INTO welcome_scans(event_id, event_tag_id, guest_id, epc, reader_id, guest_name, guest_company)
  VALUES (v_event.id, v_event_tag.id, v_guest.id, upper(btrim(p_epc)), btrim(p_reader), v_guest.name, v_guest.company)
  RETURNING id INTO v_scan_id;

  UPDATE welcome_event_tags
  SET status = 'welcomed', welcomed_at = now()
  WHERE id = v_event_tag.id;

  UPDATE welcome_guests
  SET welcomed_at = coalesce(welcomed_at, now()), last_seen_at = now()
  WHERE id = v_guest.id;

  RETURN jsonb_build_object(
    'status', 'recorded',
    'scan_id', v_scan_id,
    'event_id', v_event.id,
    'guest_name', v_guest.name,
    'guest_company', v_guest.company,
    'reader_session', v_event.reader_session,
    'cooldown_minutes', 60
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
