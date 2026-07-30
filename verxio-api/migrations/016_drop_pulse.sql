-- Remove Pulse feature tables. Keep 004_pulse.sql for migration history on
-- databases that already applied it; this drops the leftover schema.
DROP TABLE IF EXISTS pulse_contact_tags;
DROP TABLE IF EXISTS pulse_tags;
DROP TABLE IF EXISTS pulse_events;
DROP TABLE IF EXISTS pulse_runs;
DROP TABLE IF EXISTS pulse_messages;
DROP TABLE IF EXISTS pulse_conversations;
DROP TABLE IF EXISTS pulse_contacts;
DROP TABLE IF EXISTS pulse_automations;
DROP TABLE IF EXISTS pulse_channels;
