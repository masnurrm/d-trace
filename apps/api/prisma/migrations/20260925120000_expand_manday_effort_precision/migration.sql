-- Preserve quarter-day estimates and the supported 0.125-day minimum.
ALTER TABLE "manday_efforts"
ALTER COLUMN "days" TYPE DECIMAL(7,3);

-- The former one-decimal column rounded valid quarter-day values on write.
-- Values ending in .3 and .8 could not be entered under the old validation,
-- so they unambiguously represent .25 and .75 respectively.
UPDATE "manday_efforts"
SET "days" = FLOOR("days") + 0.250
WHERE "days" - FLOOR("days") = 0.300;

UPDATE "manday_efforts"
SET "days" = FLOOR("days") + 0.750
WHERE "days" - FLOOR("days") = 0.800;
