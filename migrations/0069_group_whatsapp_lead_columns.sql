-- Group admin Leads page: which columns the WhatsApp leads table shows (null = all), saved for the whole group.
ALTER TABLE "account_groups" ADD COLUMN IF NOT EXISTS "whatsapp_leads_table_columns" jsonb;
