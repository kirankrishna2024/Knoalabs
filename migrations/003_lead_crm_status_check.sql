-- 003: only known CRM states can be stored.
--   skipped  CRM not configured when the lead arrived
--   pending  waiting to be sent        sending  claimed by a worker
--   sent     delivered                 failed   will be retried
--   dead     gave up after the max number of attempts (needs manual follow-up)
ALTER TABLE leads ADD CONSTRAINT leads_crm_status_check
  CHECK (crm_status IN ('skipped','pending','sending','sent','failed','dead'));
