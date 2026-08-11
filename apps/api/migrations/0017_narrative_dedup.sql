-- 叙事去重：归档同主题（label）重复的叙事行，每组保留一条。
--
-- 背景：seedNarratives 原先只按 keyword 去重。同一份新闻简报里多组 cluster 会被 AI 标成
-- 同一个主题标签（label），但 keyword 各不相同 → 不触发去重，生成多条同 label 叙事。
-- 代码侧已加 label 合并去重（narrative.ts seedNarratives），这里是存量数据的一次性清理。
--
-- 策略：每组相同 label 的叙事，保留「active 优先、其次最新」的一条，其余归档。
-- 只改 status（active/stale → archived），不删数据，可随时回滚。归档后从「故事」列表消失，
-- 追更/历史不受影响（follows 不引用 narratives 表）。

UPDATE narratives
SET status = 'archived'
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY trim(label)
        ORDER BY
          CASE WHEN status = 'active' THEN 0 ELSE 1 END,
          last_updated DESC,
          id DESC
      ) AS rn
    FROM narratives
    WHERE status IN ('active', 'stale')
      AND label IS NOT NULL
      AND trim(label) != ''
  ) ranked
  WHERE ranked.rn > 1
);
