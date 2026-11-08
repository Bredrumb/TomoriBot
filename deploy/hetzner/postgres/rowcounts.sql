SELECT tablename,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename),
        false, true, '')))[1]::text::bigint AS row_count
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
