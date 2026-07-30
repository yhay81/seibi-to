WITH funnel AS (
  SELECT
    COUNT(DISTINCT CASE WHEN name = 'visited' THEN session_id END) AS users,
    COUNT(DISTINCT CASE WHEN name = 'vehicle_created' THEN session_id END) AS vehicle_creators,
    COUNT(DISTINCT CASE WHEN name = 'record_added' THEN session_id END) AS recorders,
    COUNT(DISTINCT CASE WHEN name = 'reminder_added' THEN session_id END) AS reminder_users,
    COUNT(DISTINCT CASE WHEN name = 'printed' THEN session_id END) AS printers,
    COUNT(DISTINCT CASE WHEN name = 'project_exported' THEN session_id END) AS exporters,
    COUNT(DISTINCT CASE WHEN name = 'project_imported' THEN session_id END) AS importers,
    COUNT(DISTINCT CASE WHEN name = 'returned' THEN session_id END) AS returned,
    COUNT(DISTINCT CASE WHEN name = 'record_added' AND created_at >= unixepoch() - 604800 THEN session_id END) AS recorders_7d,
    COUNT(DISTINCT CASE WHEN name = 'reminder_added' AND created_at >= unixepoch() - 604800 THEN session_id END) AS reminder_users_7d
  FROM product_events
  WHERE is_qa = 0
)
SELECT * FROM funnel;
