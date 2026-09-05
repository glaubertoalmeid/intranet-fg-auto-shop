CREATE TABLE `pricing_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sku` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`modality` text DEFAULT '' NOT NULL,
	`cost` real NOT NULL,
	`packaging_cost` real DEFAULT 0 NOT NULL,
	`extra_cost` real DEFAULT 0 NOT NULL,
	`weight` real DEFAULT 0 NOT NULL,
	`height` real DEFAULT 0 NOT NULL,
	`width` real DEFAULT 0 NOT NULL,
	`length` real DEFAULT 0 NOT NULL,
	`cubic_weight` real DEFAULT 0 NOT NULL,
	`charged_weight` real DEFAULT 0 NOT NULL,
	`sale_price` real NOT NULL,
	`profit` real NOT NULL,
	`margin` real NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pricing_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT '' NOT NULL
);
