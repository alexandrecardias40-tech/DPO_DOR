CREATE TABLE `budget_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`description` text NOT NULL,
	`ugr` varchar(255),
	`pi2025` varchar(255),
	`cnpj` varchar(20),
	`contractNumber` varchar(50),
	`contractStatus` varchar(50),
	`renewalStatus` text,
	`totalAnnualEstimated` int DEFAULT 0,
	`totalEmpenhoRAP` int DEFAULT 0,
	`saldoEmpenhos2025` int DEFAULT 0,
	`vigencyEndDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `budget_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monthly_consumption` (
	`id` int AUTO_INCREMENT NOT NULL,
	`budgetItemId` int NOT NULL,
	`month` varchar(7) NOT NULL,
	`amount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `monthly_consumption_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `monthly_consumption` ADD CONSTRAINT `monthly_consumption_budgetItemId_budget_items_id_fk` FOREIGN KEY (`budgetItemId`) REFERENCES `budget_items`(`id`) ON DELETE no action ON UPDATE no action;