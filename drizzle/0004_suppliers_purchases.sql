CREATE TABLE `purchase_order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`unit_cost` real DEFAULT 0 NOT NULL,
	`received_quantity` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`supplier_id` integer NOT NULL,
	`status` text DEFAULT 'elaboracao' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT '' NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`received_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`whatsapp` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`brands` text DEFAULT '' NOT NULL,
	`lead_time_days` real DEFAULT 0 NOT NULL,
	`payment_terms` text DEFAULT '' NOT NULL,
	`min_order_value` real DEFAULT 0 NOT NULL,
	`freight` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `products` ADD `supplier_id` integer;