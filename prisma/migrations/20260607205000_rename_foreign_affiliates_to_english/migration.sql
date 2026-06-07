UPDATE "affiliates"
SET "name" = CASE "name"
  WHEN '프놈펜상업은행 (PPCBank)' THEN 'PPCBank'
  WHEN 'JB증권 베트남 (JBSV)' THEN 'JB Securities Vietnam'
  WHEN 'JB프놈펜자산운용' THEN 'JB PPAM'
  WHEN 'JB캐피탈 미얀마' THEN 'JB Capital Myanmar'
  ELSE "name"
END
WHERE "name" IN (
  '프놈펜상업은행 (PPCBank)',
  'JB증권 베트남 (JBSV)',
  'JB프놈펜자산운용',
  'JB캐피탈 미얀마'
);

UPDATE "review_cases"
SET "affiliate_name" = CASE "affiliate_name"
  WHEN '프놈펜상업은행 (PPCBank)' THEN 'PPCBank'
  WHEN 'JB증권 베트남 (JBSV)' THEN 'JB Securities Vietnam'
  WHEN 'JB프놈펜자산운용' THEN 'JB PPAM'
  WHEN 'JB캐피탈 미얀마' THEN 'JB Capital Myanmar'
  ELSE "affiliate_name"
END
WHERE "affiliate_name" IN (
  '프놈펜상업은행 (PPCBank)',
  'JB증권 베트남 (JBSV)',
  'JB프놈펜자산운용',
  'JB캐피탈 미얀마'
);
