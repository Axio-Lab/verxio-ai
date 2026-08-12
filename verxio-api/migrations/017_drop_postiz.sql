-- Remove Postiz / Socials tables. Keep 007_postiz.sql for migration history on
-- databases that already applied it; this drops the leftover schema.
DROP TABLE IF EXISTS postiz_workspaces;
