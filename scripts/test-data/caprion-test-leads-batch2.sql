-- =============================================================================
-- Caprion WA Test Leads — Batch 2 (5 leads)
-- Account : e68533ca-263b-40a9-aaf9-9cbd3914e157  (Caprion WA)
-- Based on : TEST SURESH NAIR (a8602632-3855-47dc-87ef-cef2a2b22591)
-- Same fields: loan, address, company, dealer, scheme, gender, DOB, occupation
-- Different  : name, phone, email, pan, aadhaar
-- Attachments: same 3 files (PAN image, Aadhaar image, bank statement PDF)
-- Applied    : 2026-04-23
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Lead 1: TEST RAHUL VERMA
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO whatsapp_leads (
  id, business_account_id, sender_phone, customer_name, customer_phone,
  customer_email, extracted_data, status, direction, received_at, created_at, updated_at
) VALUES (
  'b1000001-0000-0000-0000-000000000001',
  'e68533ca-263b-40a9-aaf9-9cbd3914e157',
  NULL,
  'TEST RAHUL VERMA',
  '9900112234',
  'rahul.verma.test@gmail.com',
  '{
    "pan": "ABCPV1234R",
    "city": "Bengaluru",
    "state": "Karnataka",
    "gender": "Male",
    "aadhaar": "111122223333",
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
    "customer_name": "TEST RAHUL VERMA",
    "date_of_birth": "1988-06-15",
    "customer_email": "rahul.verma.test@gmail.com",
    "customer_phone": "9900112234",
    "monthly_salary": "180000",
    "current_address": "12, Gandhi Nagar, Mysuru, Karnataka",
    "account_no": "50100123456789",
    "ifsc_code": "HDFC0001234",
    "correspondence_city": "Bengaluru",
    "correspondence_state": "Karnataka",
    "correspondence_pincode": "560034"
  }'::jsonb,
  'qualified', 'incoming', NOW(), NOW(), NOW()
);

INSERT INTO whatsapp_lead_attachments (id, lead_id, business_account_id, file_name, file_type, mime_type, file_size, file_path, media_url, caption, document_category, created_at)
VALUES
  (gen_random_uuid(), 'b1000001-0000-0000-0000-000000000001', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '725417487264811', 'image', 'image/jpeg', 128253, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418455599-2940397f-d030-48d8-941a-4b4c6de5cb5f', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/725417487264811', 'pan', 'pan', NOW()),
  (gen_random_uuid(), 'b1000001-0000-0000-0000-000000000001', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '874768905579510', 'image', 'image/jpeg', 143502, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418458587-fc0b5bac-5fe2-425a-9a41-b79a35e3098c', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/874768905579510', 'aadhaar', 'aadhaar', NOW()),
  (gen_random_uuid(), 'b1000001-0000-0000-0000-000000000001', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', 'OpTransactionHistory17-04-2026.pdf', 'pdf', 'application/pdf', 411716, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418695501-aea8c16e-d192-43a4-a2b7-5a30a7ad27aa.pdf', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/1711630920197885', 'bank statement', 'bank_statement', NOW());

-- ─────────────────────────────────────────────────────────────────────────────
-- Lead 2: TEST PRIYA SHARMA
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO whatsapp_leads (
  id, business_account_id, sender_phone, customer_name, customer_phone,
  customer_email, extracted_data, status, direction, received_at, created_at, updated_at
) VALUES (
  'b1000002-0000-0000-0000-000000000002',
  'e68533ca-263b-40a9-aaf9-9cbd3914e157',
  NULL,
  'TEST PRIYA SHARMA',
  '9900112235',
  'priya.sharma.test@gmail.com',
  '{
    "pan": "DEFPS5678R",
    "city": "Bengaluru",
    "state": "Karnataka",
    "gender": "Female",
    "aadhaar": "444455556666",
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
    "customer_name": "TEST PRIYA SHARMA",
    "date_of_birth": "1990-03-22",
    "customer_email": "priya.sharma.test@gmail.com",
    "customer_phone": "9900112235",
    "monthly_salary": "180000",
    "current_address": "12, Gandhi Nagar, Mysuru, Karnataka",
    "account_no": "32101234567890",
    "ifsc_code": "SBIN0001234",
    "correspondence_city": "Bengaluru",
    "correspondence_state": "Karnataka",
    "correspondence_pincode": "560034"
  }'::jsonb,
  'qualified', 'incoming', NOW(), NOW(), NOW()
);

INSERT INTO whatsapp_lead_attachments (id, lead_id, business_account_id, file_name, file_type, mime_type, file_size, file_path, media_url, caption, document_category, created_at)
VALUES
  (gen_random_uuid(), 'b1000002-0000-0000-0000-000000000002', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '725417487264811', 'image', 'image/jpeg', 128253, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418455599-2940397f-d030-48d8-941a-4b4c6de5cb5f', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/725417487264811', 'pan', 'pan', NOW()),
  (gen_random_uuid(), 'b1000002-0000-0000-0000-000000000002', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '874768905579510', 'image', 'image/jpeg', 143502, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418458587-fc0b5bac-5fe2-425a-9a41-b79a35e3098c', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/874768905579510', 'aadhaar', 'aadhaar', NOW()),
  (gen_random_uuid(), 'b1000002-0000-0000-0000-000000000002', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', 'OpTransactionHistory17-04-2026.pdf', 'pdf', 'application/pdf', 411716, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418695501-aea8c16e-d192-43a4-a2b7-5a30a7ad27aa.pdf', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/1711630920197885', 'bank statement', 'bank_statement', NOW());

-- ─────────────────────────────────────────────────────────────────────────────
-- Lead 3: TEST ANIL PATEL
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO whatsapp_leads (
  id, business_account_id, sender_phone, customer_name, customer_phone,
  customer_email, extracted_data, status, direction, received_at, created_at, updated_at
) VALUES (
  'b1000003-0000-0000-0000-000000000003',
  'e68533ca-263b-40a9-aaf9-9cbd3914e157',
  NULL,
  'TEST ANIL PATEL',
  '9900112236',
  'anil.patel.test@gmail.com',
  '{
    "pan": "GHIPA9012R",
    "city": "Bengaluru",
    "state": "Karnataka",
    "gender": "Male",
    "aadhaar": "777788889999",
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
    "customer_name": "TEST ANIL PATEL",
    "date_of_birth": "1985-11-10",
    "customer_email": "anil.patel.test@gmail.com",
    "customer_phone": "9900112236",
    "monthly_salary": "180000",
    "current_address": "12, Gandhi Nagar, Mysuru, Karnataka",
    "account_no": "123456789012",
    "ifsc_code": "ICIC0001234",
    "correspondence_city": "Bengaluru",
    "correspondence_state": "Karnataka",
    "correspondence_pincode": "560034"
  }'::jsonb,
  'qualified', 'incoming', NOW(), NOW(), NOW()
);

INSERT INTO whatsapp_lead_attachments (id, lead_id, business_account_id, file_name, file_type, mime_type, file_size, file_path, media_url, caption, document_category, created_at)
VALUES
  (gen_random_uuid(), 'b1000003-0000-0000-0000-000000000003', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '725417487264811', 'image', 'image/jpeg', 128253, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418455599-2940397f-d030-48d8-941a-4b4c6de5cb5f', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/725417487264811', 'pan', 'pan', NOW()),
  (gen_random_uuid(), 'b1000003-0000-0000-0000-000000000003', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '874768905579510', 'image', 'image/jpeg', 143502, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418458587-fc0b5bac-5fe2-425a-9a41-b79a35e3098c', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/874768905579510', 'aadhaar', 'aadhaar', NOW()),
  (gen_random_uuid(), 'b1000003-0000-0000-0000-000000000003', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', 'OpTransactionHistory17-04-2026.pdf', 'pdf', 'application/pdf', 411716, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418695501-aea8c16e-d192-43a4-a2b7-5a30a7ad27aa.pdf', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/1711630920197885', 'bank statement', 'bank_statement', NOW());

-- ─────────────────────────────────────────────────────────────────────────────
-- Lead 4: TEST DEEPA MENON
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO whatsapp_leads (
  id, business_account_id, sender_phone, customer_name, customer_phone,
  customer_email, extracted_data, status, direction, received_at, created_at, updated_at
) VALUES (
  'b1000004-0000-0000-0000-000000000004',
  'e68533ca-263b-40a9-aaf9-9cbd3914e157',
  NULL,
  'TEST DEEPA MENON',
  '9900112237',
  'deepa.menon.test@gmail.com',
  '{
    "pan": "JKLPM3456R",
    "city": "Bengaluru",
    "state": "Karnataka",
    "gender": "Female",
    "aadhaar": "222233334444",
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
    "customer_name": "TEST DEEPA MENON",
    "date_of_birth": "1992-07-08",
    "customer_email": "deepa.menon.test@gmail.com",
    "customer_phone": "9900112237",
    "monthly_salary": "180000",
    "current_address": "12, Gandhi Nagar, Mysuru, Karnataka",
    "account_no": "9140987654321",
    "ifsc_code": "UTIB0001234",
    "correspondence_city": "Bengaluru",
    "correspondence_state": "Karnataka",
    "correspondence_pincode": "560034"
  }'::jsonb,
  'qualified', 'incoming', NOW(), NOW(), NOW()
);

INSERT INTO whatsapp_lead_attachments (id, lead_id, business_account_id, file_name, file_type, mime_type, file_size, file_path, media_url, caption, document_category, created_at)
VALUES
  (gen_random_uuid(), 'b1000004-0000-0000-0000-000000000004', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '725417487264811', 'image', 'image/jpeg', 128253, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418455599-2940397f-d030-48d8-941a-4b4c6de5cb5f', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/725417487264811', 'pan', 'pan', NOW()),
  (gen_random_uuid(), 'b1000004-0000-0000-0000-000000000004', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '874768905579510', 'image', 'image/jpeg', 143502, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418458587-fc0b5bac-5fe2-425a-9a41-b79a35e3098c', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/874768905579510', 'aadhaar', 'aadhaar', NOW()),
  (gen_random_uuid(), 'b1000004-0000-0000-0000-000000000004', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', 'OpTransactionHistory17-04-2026.pdf', 'pdf', 'application/pdf', 411716, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418695501-aea8c16e-d192-43a4-a2b7-5a30a7ad27aa.pdf', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/1711630920197885', 'bank statement', 'bank_statement', NOW());

-- ─────────────────────────────────────────────────────────────────────────────
-- Lead 5: TEST KIRAN KUMAR
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO whatsapp_leads (
  id, business_account_id, sender_phone, customer_name, customer_phone,
  customer_email, extracted_data, status, direction, received_at, created_at, updated_at
) VALUES (
  'b1000005-0000-0000-0000-000000000005',
  'e68533ca-263b-40a9-aaf9-9cbd3914e157',
  NULL,
  'TEST KIRAN KUMAR',
  '9900112238',
  'kiran.kumar.test@gmail.com',
  '{
    "pan": "MNOPK7890R",
    "city": "Bengaluru",
    "state": "Karnataka",
    "gender": "Male",
    "aadhaar": "666677778888",
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
    "customer_name": "TEST KIRAN KUMAR",
    "date_of_birth": "1987-09-30",
    "customer_email": "kiran.kumar.test@gmail.com",
    "customer_phone": "9900112238",
    "monthly_salary": "180000",
    "current_address": "12, Gandhi Nagar, Mysuru, Karnataka",
    "account_no": "8012345678901",
    "ifsc_code": "KKBK0001234",
    "correspondence_city": "Bengaluru",
    "correspondence_state": "Karnataka",
    "correspondence_pincode": "560034"
  }'::jsonb,
  'qualified', 'incoming', NOW(), NOW(), NOW()
);

INSERT INTO whatsapp_lead_attachments (id, lead_id, business_account_id, file_name, file_type, mime_type, file_size, file_path, media_url, caption, document_category, created_at)
VALUES
  (gen_random_uuid(), 'b1000005-0000-0000-0000-000000000005', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '725417487264811', 'image', 'image/jpeg', 128253, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418455599-2940397f-d030-48d8-941a-4b4c6de5cb5f', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/725417487264811', 'pan', 'pan', NOW()),
  (gen_random_uuid(), 'b1000005-0000-0000-0000-000000000005', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', '874768905579510', 'image', 'image/jpeg', 143502, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418458587-fc0b5bac-5fe2-425a-9a41-b79a35e3098c', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/874768905579510', 'aadhaar', 'aadhaar', NOW()),
  (gen_random_uuid(), 'b1000005-0000-0000-0000-000000000005', 'e68533ca-263b-40a9-aaf9-9cbd3914e157', 'OpTransactionHistory17-04-2026.pdf', 'pdf', 'application/pdf', 411716, 'https://pub-1fde9645751a4887b618ddaf30e8c546.r2.dev/whatsapp/d753624d-216d-40d3-9ae0-f9a7734e1862/e68533ca-263b-40a9-aaf9-9cbd3914e157/1776418695501-aea8c16e-d192-43a4-a2b7-5a30a7ad27aa.pdf', 'https://whatsapp.phone91.com/whatsapp-haptik-media/918655174752/1711630920197885', 'bank statement', 'bank_statement', NOW());

-- =============================================================================
-- Verification
-- =============================================================================
SELECT id, customer_name, customer_phone, extracted_data->>'pan' AS pan,
       extracted_data->>'aadhaar' AS aadhaar, status
FROM whatsapp_leads
WHERE id IN (
  'b1000001-0000-0000-0000-000000000001',
  'b1000002-0000-0000-0000-000000000002',
  'b1000003-0000-0000-0000-000000000003',
  'b1000004-0000-0000-0000-000000000004',
  'b1000005-0000-0000-0000-000000000005'
)
ORDER BY created_at;
-- Expected: 5 rows, all status=qualified, each with unique pan/aadhaar

SELECT lead_id, document_category, file_name
FROM whatsapp_lead_attachments
WHERE lead_id IN (
  'b1000001-0000-0000-0000-000000000001',
  'b1000002-0000-0000-0000-000000000002',
  'b1000003-0000-0000-0000-000000000003',
  'b1000004-0000-0000-0000-000000000004',
  'b1000005-0000-0000-0000-000000000005'
)
ORDER BY lead_id, document_category;
-- Expected: 15 rows (3 attachments × 5 leads)
