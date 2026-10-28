import { z } from "zod";

const BUSINESS_TIME_ZONE = "Africa/Lagos";

// Today's date as YYYY-MM-DD in the business time zone
function todayInBusinessTz(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE }).format(new Date());
}

export const transactionDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, "Use YYYY-MM-DD or an ISO date-time")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date")
  .refine((v) => v.slice(0, 10) <= todayInBusinessTz(), "Date cannot be in the future");

export const positiveQuantity = z.number().positive("Quantity must be greater than zero");

// A plain calendar date (YYYY-MM-DD). Unlike transactionDateSchema, future dates are allowed
// (used for due dates).
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");