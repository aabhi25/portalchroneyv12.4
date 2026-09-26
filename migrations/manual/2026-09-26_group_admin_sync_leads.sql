-- Group admins: new "Can sync leads" permission (off by default).
-- Lets a group admin push the group's leads to each member account's
-- LeadSquared / Salesforce CRM from the group-admin Leads page.
-- Also applied automatically at startup by server/init.ts.
ALTER TABLE public.account_group_admins
  ADD COLUMN IF NOT EXISTS can_sync_leads TEXT NOT NULL DEFAULT 'false';
