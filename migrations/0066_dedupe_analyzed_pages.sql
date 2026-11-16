-- Website scan re-scans used to add every page again: keep only the newest copy of each page
-- (same address, with or without a trailing slash). The newest copy already carries the page's channel tags.
DELETE FROM "analyzed_pages" a
USING "analyzed_pages" b
WHERE a."business_account_id" = b."business_account_id"
  AND regexp_replace(a."page_url", '/+$', '') = regexp_replace(b."page_url", '/+$', '')
  AND (a."analyzed_at" < b."analyzed_at" OR (a."analyzed_at" = b."analyzed_at" AND a."id" < b."id"));
