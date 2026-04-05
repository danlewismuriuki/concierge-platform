-- CreateTable
CREATE TABLE `jobs` (
    `id` VARCHAR(191) NOT NULL,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `type` ENUM('ride', 'delivery', 'grocery') NOT NULL,
    `status` ENUM('pending', 'in_progress', 'completed', 'failed') NOT NULL DEFAULT 'pending',
    `provider` ENUM('uber_sim', 'doordash_sim') NOT NULL,
    `claimed_by` VARCHAR(191) NULL,
    `claimed_at` DATETIME(3) NULL,
    `attempts_count` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 5,
    `provider_job_id` VARCHAR(191) NULL,
    `last_error` TEXT NULL,
    `caller_phone` VARCHAR(191) NULL,
    `call_sid` VARCHAR(191) NULL,
    `request_payload` JSON NOT NULL,
    `response_payload` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `jobs_idempotency_key_key`(`idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_events` (
    `event_id` VARCHAR(191) NOT NULL,
    `processed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `provider` VARCHAR(191) NOT NULL,
    `job_id` VARCHAR(191) NULL,

    PRIMARY KEY (`event_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
