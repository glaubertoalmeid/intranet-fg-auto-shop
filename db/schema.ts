// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const pricingProducts=sqliteTable("pricing_products",{
  id:integer("id").primaryKey({autoIncrement:true}),sku:text("sku").notNull().default(""),name:text("name").notNull(),
  platform:text("platform").notNull(),modality:text("modality").notNull().default(""),cost:real("cost").notNull(),
  packagingCost:real("packaging_cost").notNull().default(0),extraCost:real("extra_cost").notNull().default(0),
  weight:real("weight").notNull().default(0),height:real("height").notNull().default(0),width:real("width").notNull().default(0),length:real("length").notNull().default(0),
  cubicWeight:real("cubic_weight").notNull().default(0),chargedWeight:real("charged_weight").notNull().default(0),
  salePrice:real("sale_price").notNull(),profit:real("profit").notNull(),margin:real("margin").notNull(),
  createdBy:text("created_by").notNull().default(""),updatedAt:text("updated_at").notNull().default("")
});
export const pricingSettings=sqliteTable("pricing_settings",{id:integer("id").primaryKey(),data:text("data").notNull(),updatedBy:text("updated_by").notNull().default(""),updatedAt:text("updated_at").notNull().default("")});
export const listings=sqliteTable("listings",{id:integer("id").primaryKey({autoIncrement:true}),sku:text("sku").notNull().default(""),productName:text("product_name").notNull(),platform:text("platform").notNull(),status:text("status").notNull().default("preparacao"),salePrice:real("sale_price").notNull().default(0),title:text("title").notNull().default(""),description:text("description").notNull().default(""),packaging:text("packaging").notNull().default(""),weight:real("weight").notNull().default(0),width:real("width").notNull().default(0),length:real("length").notNull().default(0),height:real("height").notNull().default(0),imageKeys:text("image_keys").notNull().default("[]"),listingUrl:text("listing_url").notNull().default(""),createdBy:text("created_by").notNull().default(""),updatedBy:text("updated_by").notNull().default(""),createdAt:text("created_at").notNull().default(""),updatedAt:text("updated_at").notNull().default("")});

// Cadastro mestre de produtos (Etapa 1 — Produtos e Estoque). Espelho gerencial sincronizado do
// Bling; min/max de estoque e localização física são configurados aqui, o resto vem do Bling.
export const products=sqliteTable("products",{
  id:integer("id").primaryKey({autoIncrement:true}),
  blingProductId:text("bling_product_id").notNull().default(""),
  sku:text("sku").notNull().default(""),
  gtin:text("gtin").notNull().default(""),
  name:text("name").notNull().default(""),
  brand:text("brand").notNull().default(""),
  category:text("category").notNull().default(""),
  subcategory:text("subcategory").notNull().default(""),
  supplier:text("supplier").notNull().default(""),
  supplierId:integer("supplier_id"),
  cost:real("cost").notNull().default(0),
  salePrice:real("sale_price").notNull().default(0),
  weight:real("weight").notNull().default(0),
  width:real("width").notNull().default(0),
  height:real("height").notNull().default(0),
  length:real("length").notNull().default(0),
  stockPhysical:real("stock_physical").notNull().default(0),
  stockReserved:real("stock_reserved").notNull().default(0),
  minStock:real("min_stock").notNull().default(0),
  maxStock:real("max_stock").notNull().default(0),
  location:text("location").notNull().default(""),
  status:text("status").notNull().default("ativo"),
  lastSaleAt:text("last_sale_at").notNull().default(""),
  syncedAt:text("synced_at").notNull().default(""),
  updatedBy:text("updated_by").notNull().default("")
});

// Etapa 3 — Compras. Fornecedores não existiam de forma relacional (era texto livre no produto);
// suppliers.name é usado para casar com products.supplier até o vínculo por supplierId ser feito manualmente.
export const suppliers=sqliteTable("suppliers",{
  id:integer("id").primaryKey({autoIncrement:true}),
  name:text("name").notNull(),
  contact:text("contact").notNull().default(""),
  phone:text("phone").notNull().default(""),
  whatsapp:text("whatsapp").notNull().default(""),
  email:text("email").notNull().default(""),
  brands:text("brands").notNull().default(""),
  leadTimeDays:real("lead_time_days").notNull().default(0),
  paymentTerms:text("payment_terms").notNull().default(""),
  minOrderValue:real("min_order_value").notNull().default(0),
  freight:text("freight").notNull().default(""),
  notes:text("notes").notNull().default(""),
  createdBy:text("created_by").notNull().default(""),
  createdAt:text("created_at").notNull().default(""),
  updatedAt:text("updated_at").notNull().default("")
});

export const purchaseOrders=sqliteTable("purchase_orders",{
  id:integer("id").primaryKey({autoIncrement:true}),
  supplierId:integer("supplier_id").notNull(),
  status:text("status").notNull().default("elaboracao"),
  notes:text("notes").notNull().default(""),
  createdBy:text("created_by").notNull().default(""),
  createdAt:text("created_at").notNull().default(""),
  updatedAt:text("updated_at").notNull().default(""),
  sentAt:text("sent_at").notNull().default(""),
  receivedAt:text("received_at").notNull().default("")
});

export const purchaseOrderItems=sqliteTable("purchase_order_items",{
  id:integer("id").primaryKey({autoIncrement:true}),
  orderId:integer("order_id").notNull(),
  productId:integer("product_id").notNull(),
  quantity:real("quantity").notNull().default(0),
  unitCost:real("unit_cost").notNull().default(0),
  receivedQuantity:real("received_quantity").notNull().default(0)
});
