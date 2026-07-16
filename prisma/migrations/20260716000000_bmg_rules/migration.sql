-- CreateTable
CREATE TABLE "bmg_categories" (
    "id" UUID NOT NULL,
    "key" "Discipline" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bmg_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bmg_rules" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "grade_system" "GradeSystem",
    "min_grade_raw" TEXT,
    "min_grade_normalised_score" INTEGER,
    "min_count" INTEGER NOT NULL,
    "extra_constraint_json" JSONB,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "source_note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bmg_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bmg_categories_key_key" ON "bmg_categories"("key");

-- CreateIndex
CREATE INDEX "bmg_rules_category_id_idx" ON "bmg_rules"("category_id");

-- AddForeignKey
ALTER TABLE "bmg_rules" ADD CONSTRAINT "bmg_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "bmg_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
