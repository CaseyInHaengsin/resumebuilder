-- One-time: per-resume order now comes from the join rows' sort_order, so seed it
-- with the order the PDF used before (library sort_order, then library id).
UPDATE `resume_jobs` SET `sort_order` = ranked.`rank`
FROM (
	SELECT rj.`id` AS `id`,
		ROW_NUMBER() OVER (PARTITION BY rj.`resume_id` ORDER BY l.`sort_order`, l.`id`) - 1 AS `rank`
	FROM `resume_jobs` rj
	JOIN `jobs` l ON l.`id` = rj.`job_id`
) AS ranked
WHERE `resume_jobs`.`id` = ranked.`id`;
--> statement-breakpoint
UPDATE `resume_projects` SET `sort_order` = ranked.`rank`
FROM (
	SELECT rj.`id` AS `id`,
		ROW_NUMBER() OVER (PARTITION BY rj.`resume_id` ORDER BY l.`sort_order`, l.`id`) - 1 AS `rank`
	FROM `resume_projects` rj
	JOIN `projects` l ON l.`id` = rj.`project_id`
) AS ranked
WHERE `resume_projects`.`id` = ranked.`id`;
--> statement-breakpoint
UPDATE `resume_skills` SET `sort_order` = ranked.`rank`
FROM (
	SELECT rj.`id` AS `id`,
		ROW_NUMBER() OVER (PARTITION BY rj.`resume_id` ORDER BY l.`sort_order`, l.`id`) - 1 AS `rank`
	FROM `resume_skills` rj
	JOIN `skills` l ON l.`id` = rj.`skill_id`
) AS ranked
WHERE `resume_skills`.`id` = ranked.`id`;
--> statement-breakpoint
UPDATE `resume_bullets` SET `sort_order` = ranked.`rank`
FROM (
	SELECT rj.`id` AS `id`,
		ROW_NUMBER() OVER (PARTITION BY rj.`resume_id` ORDER BY l.`sort_order`, l.`id`) - 1 AS `rank`
	FROM `resume_bullets` rj
	JOIN `bullets` l ON l.`id` = rj.`bullet_id`
) AS ranked
WHERE `resume_bullets`.`id` = ranked.`id`;
