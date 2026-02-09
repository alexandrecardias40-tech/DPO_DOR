import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /**
   * Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user.
   * This mirrors the Manus account and should be used for authentication lookups.
   */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Budget and Expense Tables
export const budgetItems = mysqlTable("budget_items", {
  id: int("id").autoincrement().primaryKey(),
  description: text("description").notNull(),
  ugr: varchar("ugr", { length: 255 }),
  pi2025: varchar("pi2025", { length: 255 }),
  cnpj: varchar("cnpj", { length: 20 }),
  contractNumber: varchar("contractNumber", { length: 50 }),
  contractStatus: varchar("contractStatus", { length: 50 }),
  renewalStatus: text("renewalStatus"),
  totalAnnualEstimated: int("totalAnnualEstimated").default(0),
  totalEmpenhoRAP: int("totalEmpenhoRAP").default(0),
  saldoEmpenhos2025: int("saldoEmpenhos2025").default(0),
  vigencyEndDate: timestamp("vigencyEndDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BudgetItem = typeof budgetItems.$inferSelect;
export type InsertBudgetItem = typeof budgetItems.$inferInsert;

export const monthlyConsumption = mysqlTable("monthly_consumption", {
  id: int("id").autoincrement().primaryKey(),
  budgetItemId: int("budgetItemId").notNull().references(() => budgetItems.id),
  month: varchar("month", { length: 7 }).notNull(), // YYYY-MM format
  amount: int("amount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MonthlyConsumption = typeof monthlyConsumption.$inferSelect;
export type InsertMonthlyConsumption = typeof monthlyConsumption.$inferInsert;