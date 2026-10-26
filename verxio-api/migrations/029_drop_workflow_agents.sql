-- Remove the Agents product: created agents, SDR, support, embeds, and human-task tables.
-- Databases that already applied the older workflow migrations drop the leftover schema.
DROP TABLE IF EXISTS micromgr_submission_items;
DROP TABLE IF EXISTS micromgr_flags;
DROP TABLE IF EXISTS micromgr_reports;
DROP TABLE IF EXISTS micromgr_submissions;
DROP TABLE IF EXISTS micromgr_outbound;
DROP TABLE IF EXISTS micromgr_workers;
DROP TABLE IF EXISTS micromgr_tasks;
DROP TABLE IF EXISTS sdr_contacts;
DROP TABLE IF EXISTS sdr_sessions;
DROP TABLE IF EXISTS workflow_agent_sessions;
DROP TABLE IF EXISTS workflow_agent_setup_approvals;
DROP TABLE IF EXISTS workflow_agent_setup_drafts;
DROP TABLE IF EXISTS workflow_run_events;
DROP TABLE IF EXISTS workflow_runs;
DROP TABLE IF EXISTS workflow_deliveries;
DROP TABLE IF EXISTS workflow_agent_embed_configs;
DROP TABLE IF EXISTS workflow_triggers;
DROP TABLE IF EXISTS workflow_custom_tools;
DROP TABLE IF EXISTS knowledge_chunks;
DROP TABLE IF EXISTS knowledge_documents;
DROP TABLE IF EXISTS knowledge_bases;
DROP TABLE IF EXISTS workflow_agents;
