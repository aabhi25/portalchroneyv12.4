-- =============================================================================
-- Caprion WA Test Leads — Batch 3 (3 leads)
-- Account : e68533ca-263b-40a9-aaf9-9cbd3914e157  (Caprion WA)
-- Purpose : Verify banking details sync with real ICICI IFSC (ICIC0003168)
-- Banking : account_no=316805000712, ifsc_code=ICIC0003168 (same for all 3)
-- Applied : 2026-04-24
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Lead 6: TEST VIKRAM SINGH
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO whatsapp_leads (
  id, business_account_id, sender_phone, customer_name, customer_phone,
  customer_email, extracted_data, status, direction, received_at, created_at, updated_at
) VALUES (
  'b1000006-0000-0000-0000-000000000006',
  'e68533ca-263b-40a9-aaf9-9cbd3914e157',
  NULL,
  'TEST VIKRAM SINGH',
  '9900112239',
  'vikram.singh.test@gmail.com',
  '{
    "pan": "QRSVS2345R",
    "city": "Bengaluru",
    "state": "Karnataka",
    "gender": "Male",
    "aadhaar": "333344445555",
    "pincode": "560034",
    "loan_type": "CL",
    "occupation": "Salaried",
    "store_name": "Homelane Bengaluru",
    "dealer_city": "Bengaluru",
    "dealer_name": "Homelane",
    "loan_amount": "500000",
    "scheme_name": "126",
    "company_name": "Tech Mahindra Limited",
    "full_address": "45, 3rd Cross, Koramangala, Bengaluru",
    "customer_name": "TEST VIKRAM SINGH",
    "date_of_birth": "1989-04-25",
    "customer_email": "vikram.singh.test@gmail.com",
    "customer_phone": "9900112239",
    "monthly_salary": "180000",
    "current_address": "12, Gandhi Nagar, Mysuru, Karnataka",
    "account_no": "316805000712",
    "ifsc_code": "ICIC0003168",
    "correspondence_city": "Bengaluru",
    "correspondence_state": "Karnataka",
    "correspondence_pincode": "560034"
  }'::jsonb,
  'qualified', 'incoming', NOW(), NOW(), NOW()
);

INSERT INTO whatsapp_lead_attachments (id, lead_id, business_account_id, file_name, file_type, mime_type, file_size, file_path, media_url, caption, document_category, created_at)
VALUES
  (gen_random_uuid(), 'b1000006-0000-0000-0000-000000000006', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '725417487264811', 'image', 'image/jpeg', 128253, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418455599-2940397f-d030-48d8-941a-4b4c6de5cb5f', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/725417487264811', 'pan', 'pan', NOW()),
  (gen_random_uuid(), 'b1000006-0000-0000-0000-000000000006', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '874768905579510', 'image', 'image/jpeg', 143502, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418458587-fc0b5bac-5fe2-425a-9a41-b79a35e3098c', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/874768905579510', 'aadhaar', 'aadhaar', NOW()),
  (gen_random_uuid(), 'b1000006-0000-0000-0000-000000000006', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', 'OpTransactionHistory17-04-2026.pdf', 'pdf', 'application/pdf', 411716, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418695501-aea8c16e-d192-43a4-a2b7-5a30a7ad27aa.pdf', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/1711630920197885', 'bank statement', 'bank_statement', NOW());

-- ─────────────────────────────────────────────────────────────────────────────
-- Lead 7: TEST MEERA IYER
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO whatsapp_leads (
  id, business_account_id, sender_phone, customer_name, customer_phone,
  customer_email, extracted_data, status, direction, received_at, created_at, updated_at
) VALUES (
  'b1000007-0000-0000-0000-000000000007',
  'e68533ca-263b-40a9-aaf9-9cbd3914e157',
  NULL,
  'TEST MEERA IYER',
  '9900112240',
  'meera.iyer.test@gmail.com',
  '{
    "pan": "TUVMI6789R",
    "city": "Bengaluru",
    "state": "Karnataka",
    "gender": "Female",
    "aadhaar": "555566667777",
    "pincode": "560034",
    "loan_type": "CL",
    "occupation": "Salaried",
    "store_name": "Homelane Bengaluru",
    "dealer_city": "Bengaluru",
    "dealer_name": "Homelane",
    "loan_amount": "500000",
    "scheme_name": "126",
    "company_name": "Tech Mahindra Limited",
    "full_address": "45, 3rd Cross, Koramangala, Bengaluru",
    "customer_name": "TEST MEERA IYER",
    "date_of_birth": "1993-12-01",
    "customer_email": "meera.iyer.test@gmail.com",
    "customer_phone": "9900112240",
    "monthly_salary": "180000",
    "current_address": "12, Gandhi Nagar, Mysuru, Karnataka",
    "account_no": "316805000712",
    "ifsc_code": "ICIC0003168",
    "correspondence_city": "Bengaluru",
    "correspondence_state": "Karnataka",
    "correspondence_pincode": "560034"
  }'::jsonb,
  'qualified', 'incoming', NOW(), NOW(), NOW()
);

INSERT INTO whatsapp_lead_attachments (id, lead_id, business_account_id, file_name, file_type, mime_type, file_size, file_path, media_url, caption, document_category, created_at)
VALUES
  (gen_random_uuid(), 'b1000007-0000-0000-0000-000000000007', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '725417487264811', 'image', 'image/jpeg', 128253, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418455599-2940397f-d030-48d8-941a-4b4c6de5cb5f', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/725417487264811', 'pan', 'pan', NOW()),
  (gen_random_uuid(), 'b1000007-0000-0000-0000-000000000007', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '874768905579510', 'image', 'image/jpeg', 143502, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418458587-fc0b5bac-5fe2-425a-9a41-b79a35e3098c', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/874768905579510', 'aadhaar', 'aadhaar', NOW()),
  (gen_random_uuid(), 'b1000007-0000-0000-0000-000000000007', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', 'OpTransactionHistory17-04-2026.pdf', 'pdf', 'application/pdf', 411716, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418695501-aea8c16e-d192-43a4-a2b7-5a30a7ad27aa.pdf', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/1711630920197885', 'bank statement', 'bank_statement', NOW());

-- ─────────────────────────────────────────────────────────────────────────────
-- Lead 8: TEST ARJUN NAIR
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO whatsapp_leads (
  id, business_account_id, sender_phone, customer_name, customer_phone,
  customer_email, extracted_data, status, direction, received_at, created_at, updated_at
) VALUES (
  'b1000008-0000-0000-0000-000000000008',
  'e68533ca-263b-40a9-aaf9-9cbd3914e157',
  NULL,
  'TEST ARJUN NAIR',
  '9900112241',
  'arjun.nair.test@gmail.com',
  '{
    "pan": "WXYAN0123R",
    "city": "Bengaluru",
    "state": "Karnataka",
    "gender": "Male",
    "aadhaar": "888899990000",
    "pincode": "560034",
    "loan_type": "CL",
    "occupation": "Salaried",
    "store_name": "Homelane Bengaluru",
    "dealer_city": "Bengaluru",
    "dealer_name": "Homelane",
    "loan_amount": "500000",
    "scheme_name": "126",
    "company_name": "Tech Mahindra Limited",
    "full_address": "45, 3rd Cross, Koramangala, Bengaluru",
    "customer_name": "TEST ARJUN NAIR",
    "date_of_birth": "1986-08-14",
    "customer_email": "arjun.nair.test@gmail.com",
    "customer_phone": "9900112241",
    "monthly_salary": "180000",
    "current_address": "12, Gandhi Nagar, Mysuru, Karnataka",
    "account_no": "316805000712",
    "ifsc_code": "ICIC0003168",
    "correspondence_city": "Bengaluru",
    "correspondence_state": "Karnataka",
    "correspondence_pincode": "560034"
  }'::jsonb,
  'qualified', 'incoming', NOW(), NOW(), NOW()
);

INSERT INTO whatsapp_lead_attachments (id, lead_id, business_account_id, file_name, file_type, mime_type, file_size, file_path, media_url, caption, document_category, created_at)
VALUES
  (gen_random_uuid(), 'b1000008-0000-0000-0000-000000000008', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '725417487264811', 'image', 'image/jpeg', 128253, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418455599-2940397f-d030-48d8-941a-4b4c6de5cb5f', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/725417487264811', 'pan', 'pan', NOW()),
  (gen_random_uuid(), 'b1000008-0000-0000-0000-000000000008', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '874768905579510', 'image', 'image/jpeg', 143502, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418458587-fc0b5bac-5fe2-425a-9a41-b79a35e3098c', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/874768905579510', 'aadhaar', 'aadhaar', NOW()),
  (gen_random_uuid(), 'b1000008-0000-0000-0000-000000000008', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', 'OpTransactionHistory17-04-2026.pdf', 'pdf', 'application/pdf', 411716, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418695501-aea8c16e-d192-43a4-a2b7-5a30a7ad27aa.pdf', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/1711630920197885', 'bank statement', 'bank_statement', NOW());

-- =============================================================================
-- Verification
-- =============================================================================
SELECT id, customer_name, customer_phone,
       extracted_data->>'pan' AS pan,
       extracted_data->>'aadhaar' AS aadhaar,
       extracted_data->>'account_no' AS account_no,
       extracted_data->>'ifsc_code' AS ifsc_code,
       status
FROM whatsapp_leads
WHERE id IN (
  'b1000006-0000-0000-0000-000000000006',
  'b1000007-0000-0000-0000-000000000007',
  'b1000008-0000-0000-0000-000000000008'
)
ORDER BY customer_name;
