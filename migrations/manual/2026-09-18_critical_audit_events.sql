CREATE TABLE IF NOT EXISTS audit_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamp NOT NULL DEFAULT now(),
  actor_user_id varchar,
  actor_username text,
  actor_role text,
  business_account_id varchar,
  session_fingerprint text,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  outcome text NOT NULL,
  ip_address text,
  user_agent text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_events_occurred_at_idx ON audit_events (occurred_at);
CREATE INDEX IF NOT EXISTS audit_events_actor_user_id_idx ON audit_events (actor_user_id);
CREATE INDEX IF NOT EXISTS audit_events_business_account_id_idx ON audit_events (business_account_id);
CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events (action);
CREATE INDEX IF NOT EXISTS audit_events_request_id_idx ON audit_events (request_id);
CREATE UNIQUE INDEX IF NOT EXISTS audit_events_one_export_terminal_event_idx
  ON audit_events (resource_id)
  WHERE action IN ('leads.export.file_generated', 'leads.export.file_failed');

-- Upgrade safety for environments that briefly received the initial table
-- definition with mutating ON DELETE SET NULL foreign keys.
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_user_id_fkey;
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_business_account_id_fkey;

COMMENT ON TABLE audit_events IS
  'Append-only security audit events. Application APIs must not update or delete rows.';

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_prevent_mutation ON audit_events;
CREATE TRIGGER audit_events_prevent_mutation
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();