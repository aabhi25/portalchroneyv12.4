-- Group admins: new "Delete" permission (off by default, granted by a super admin).
-- Lets a group admin permanently delete selected leads and conversations across
-- the group's accounts from the group-admin dashboard.
-- Also applied automatically at startup by server/init.ts.
ALTER TABLE public.account_group_admins
  ADD COLUMN IF NOT EXISTS can_delete_data TEXT NOT NULL DEFAULT 'false';
