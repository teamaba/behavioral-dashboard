-- Remove legacy NOT NULL constraints on domain_slug now that
-- behavior_id + domain_id are the primary keys for all queries.
ALTER TABLE data_points  ALTER COLUMN domain_slug DROP NOT NULL;
ALTER TABLE chart_meta   ALTER COLUMN domain_slug DROP NOT NULL;
ALTER TABLE goals        ALTER COLUMN domain_slug DROP NOT NULL;
