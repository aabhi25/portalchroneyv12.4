-- =============================================================================
-- Caprion WA Test Lead: TEST SURESH NAIR — dealer field corrections
-- =============================================================================
-- Lead ID : a8602632-3855-47dc-87ef-cef2a2b22591
-- Account : e68533ca-263b-40a9-aaf9-9cbd3914e157  (Caprion WA)
-- Applied : 2026-04-23
-- =============================================================================

-- Tasks #20/#21: Set dealer_name, store_name, dealer_city (initial setup)
-- Task #24: Update dealer_city from "Bengaluru-HL" → "Bengaluru"
UPDATE whatsapp_leads
SET
  extracted_data = COALESCE(extracted_data, '{}'::jsonb)
                   || '{"dealer_name":"Homelane","store_name":"Homelane Bengaluru","dealer_city":"Bengaluru"}'::jsonb,
  updated_at     = NOW()
WHERE id                  = 'a8602632-3855-47dc-87ef-cef2a2b22591'
  AND business_account_id = 'e68533ca-263b-40a9-aaf9-9cbd3914e157';

-- Verification
SELECT
  id,
  extracted_data->>'dealer_name' AS dealer_name,
  extracted_data->>'store_name'  AS store_name,
  extracted_data->>'dealer_city' AS dealer_city
FROM whatsapp_leads
WHERE id                  = 'a8602632-3855-47dc-87ef-cef2a2b22591'
  AND business_account_id = 'e68533ca-263b-40a9-aaf9-9cbd3914e157';
-- Expected: dealer_name='Homelane', store_name='Homelane Bengaluru', dealer_city='Bengaluru'

-- Store credential match check
SELECT id, store_name, dealer_name, city, sid, store_id
FROM crm_store_credentials
WHERE business_account_id = 'e68533ca-263b-40a9-aaf9-9cbd3914e157'
  AND LOWER(TRIM(store_name))  = 'homelane bengaluru'
  AND LOWER(TRIM(dealer_name)) = 'homelane';
-- Expected: sid='S00014', store_id=14
