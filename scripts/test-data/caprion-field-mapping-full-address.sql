-- =============================================================================
-- Task #28: Fix Caprion CRM field mapping — add full_address to payload
-- =============================================================================
-- Account : e68533ca-263b-40a9-aaf9-9cbd3914e157  (Caprion WA)
-- Problem : extracted.full_address was mapped to crm_field=correspondence_full_address2
--           which is not in CAPRION_ACCEPTED_FIELDS, so it was silently dropped.
--           Client's working Postman payload includes full_address (home address).
-- Fix     : Change crm_field to 'full_address' (IS in CAPRION_ACCEPTED_FIELDS).
-- Applied : 2026-04-23
-- =============================================================================

UPDATE custom_crm_field_mappings
SET crm_field  = 'full_address',
    updated_at = NOW()
WHERE id                  = 'c8b373b9-a075-44c7-9603-7ad8650cbbdd'
  AND business_account_id = 'e68533ca-263b-40a9-aaf9-9cbd3914e157';

-- Verification
SELECT id, crm_field, source_field
FROM custom_crm_field_mappings
WHERE id = 'c8b373b9-a075-44c7-9603-7ad8650cbbdd';
-- Expected: crm_field = 'full_address', source_field = 'extracted.full_address'
