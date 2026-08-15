-- =============================================================================
-- Irfan lead data corrections (Tasks #22 + #23)
-- Lead ID : d753624d-216d-40d3-9ae0-f9a7734e1862
-- Account : e68533ca-263b-40a9-aaf9-9cbd3914e157  (Caprion WA)
-- =============================================================================

-- Task #22 — dealer fields
-- dealer_name "Design Cafe" → "Homelane"
-- store_name  "Gachibowli-DC" → "Homelane-Bengaluru"
-- dealer_city "Hyderabad-DC"  → "Bengaluru"
UPDATE whatsapp_leads
SET
  extracted_data = COALESCE(extracted_data, '{}'::jsonb)
                   || '{"dealer_name":"Homelane","store_name":"Homelane-Bengaluru","dealer_city":"Bengaluru"}'::jsonb,
  updated_at     = NOW()
WHERE id                  = 'd753624d-216d-40d3-9ae0-f9a7734e1862'
  AND business_account_id = 'e68533ca-263b-40a9-aaf9-9cbd3914e157';

-- Task #23 — scheme_name
-- scheme_name "36/1" → "126"
UPDATE whatsapp_leads
SET
  extracted_data = COALESCE(extracted_data, '{}'::jsonb)
                   || '{"scheme_name":"126"}'::jsonb,
  updated_at     = NOW()
WHERE id                  = 'd753624d-216d-40d3-9ae0-f9a7734e1862'
  AND business_account_id = 'e68533ca-263b-40a9-aaf9-9cbd3914e157';

-- Verification — confirm all four corrected fields
SELECT
  id,
  extracted_data->>'dealer_name'  AS dealer_name,
  extracted_data->>'store_name'   AS store_name,
  extracted_data->>'dealer_city'  AS dealer_city,
  extracted_data->>'scheme_name'  AS scheme_name
FROM whatsapp_leads
WHERE id                  = 'd753624d-216d-40d3-9ae0-f9a7734e1862'
  AND business_account_id = 'e68533ca-263b-40a9-aaf9-9cbd3914e157';
-- Expected:
--   dealer_name = 'Homelane'
--   store_name  = 'Homelane-Bengaluru'
--   dealer_city = 'Bengaluru'
--   scheme_name = '126'
