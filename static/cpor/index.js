// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
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
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var budgetItems = mysqlTable("budget_items", {
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
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var monthlyConsumption = mysqlTable("monthly_consumption", {
  id: int("id").autoincrement().primaryKey(),
  budgetItemId: int("budgetItemId").notNull().references(() => budgetItems.id),
  month: varchar("month", { length: 7 }).notNull(),
  // YYYY-MM format
  amount: int("amount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUser(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUser(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUser(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/routers.ts
import fs from "fs";
import path from "path";
import { z as z2 } from "zod";

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/budgetData.ts
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import * as XLSX from "xlsx";
dayjs.extend(customParseFormat);
var MONTH_KEY_REGEX = /^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?$/;
var HEADER_PI_YEAR_REGEX = /\bpi\s*[-_/]?\s*(20\d{2})\b/i;
var EXPIRING_DAYS = 90;
var PREFERRED_SHEETS = ["Despesas", "Execu\xE7\xE3o", "Execucao", "CEMP", "Base"];
var EMPTY_DASHBOARD_DATA = {
  kpis: {
    total_anual_estimado: 0,
    total_empenhado: 0,
    total_comprometido: 0,
    saldo_a_empenhar: 0,
    percentual_execucao: 0,
    taxa_execucao: 0,
    count_expiring_contracts: 0,
    count_expired_contracts: 0
  },
  ugr_analysis: [],
  monthly_consumption: [],
  expiring_contracts_list: [],
  expired_contracts_list: [],
  raw_data_for_filters: [],
  metadata: {
    month_keys: [],
    reference_year: null,
    updated_at: dayjs().toISOString()
  }
};
var normalizeText = (value) => {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
};
var normalizeToken = (value) => {
  const text2 = normalizeText(value);
  if (!text2) return "";
  if (text2 === "nan" || text2 === "none" || text2 === "null") return "";
  return text2;
};
var isNullishLike = (value) => {
  if (value === null || value === void 0) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "string") {
    const token = normalizeToken(value);
    return !token;
  }
  return false;
};
var maybeString = (value) => {
  if (isNullishLike(value)) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    if (Math.abs(value) >= 1e15) return value.toFixed(0);
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value).trim();
};
var firstDefined = (...values) => {
  for (const value of values) {
    if (!isNullishLike(value)) return value;
  }
  return void 0;
};
var toNumber = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const trimmed = value.replace(/R\$/gi, "").replace(/\s+/g, "").replace(/%$/, "").trim();
    if (!trimmed) return 0;
    const hasComma = trimmed.includes(",");
    const hasDot = trimmed.includes(".");
    let normalized = trimmed;
    if (hasComma && hasDot) {
      const commaIdx = trimmed.lastIndexOf(",");
      const dotIdx = trimmed.lastIndexOf(".");
      if (commaIdx > dotIdx) {
        normalized = trimmed.replace(/\./g, "").replace(",", ".");
      } else {
        normalized = trimmed.replace(/,/g, "");
      }
    } else if (hasComma) {
      normalized = trimmed.replace(",", ".");
    }
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return 0;
};
var fromExcelSerial = (value) => {
  const excelEpoch = new Date(1900, 0, 1);
  const date = new Date(excelEpoch.getTime() + (value - 1) * 24 * 60 * 60 * 1e3);
  if (value >= 60) date.setTime(date.getTime() - 24 * 60 * 60 * 1e3);
  const parsed = dayjs(date);
  return parsed.isValid() ? parsed : null;
};
var parseDateValue = (value) => {
  if (value instanceof Date) {
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const serial = fromExcelSerial(value);
    if (serial?.isValid()) return serial;
    return null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/.test(trimmed)) {
    const parsed = dayjs(trimmed, ["YYYY-MM-DD", "YYYY-MM-DD HH:mm:ss", "YYYY-MM-DDTHH:mm:ss"], true);
    if (parsed.isValid()) return parsed;
  }
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const parsed = dayjs(trimmed, "YYYY-MM", true);
    if (parsed.isValid()) return parsed;
  }
  const dateMatches = trimmed.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/g);
  if (dateMatches && dateMatches.length > 0) {
    const candidate = dateMatches[dateMatches.length - 1];
    const parsed = dayjs(candidate, ["DD/MM/YYYY", "D/M/YYYY", "DD/MM/YY", "D/M/YY"], true);
    if (parsed.isValid()) return parsed;
  }
  const fallback = dayjs(trimmed, ["DD/MM/YYYY", "D/M/YYYY", "DD-MM-YYYY", "D-M-YYYY"], true);
  return fallback.isValid() ? fallback : null;
};
var toMonthKey = (value) => {
  const parsed = parseDateValue(value);
  if (!parsed?.isValid()) return null;
  return `${parsed.format("YYYY-MM")}-01 00:00:00`;
};
var isMonthKey = (key) => MONTH_KEY_REGEX.test(key);
var normalizeMonthKey = (key) => {
  const match = key.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return key;
  return `${match[1]} 00:00:00`;
};
var mapHeaderTokenToField = (token) => {
  if (!token) return null;
  if (token.includes("descricao das despesas") || token === "despesa" || token.includes("acompanhamento de contratos")) {
    return "Despesa";
  }
  if (token === "ugr") return "UGR";
  if (token.startsWith("pi ") || token === "pi" || token.startsWith("pi20")) return "PI";
  if (token === "cnpj") return "CNPJ";
  if (token.includes("processo")) return "Processo";
  if (token.includes("vigencia")) return "Data_Vigencia_Fim";
  if (token.includes("status do contrato") || token === "status contrato" || token === "status") {
    return "Status_Contrato";
  }
  if (token.includes("situacao da prorrogacao") || token.includes("situacao prorrogacao")) {
    return "Situacao_Prorrogacao";
  }
  if (token.includes("contrato") && token.includes("numero") || token.startsWith("n contrato") || token === "n contrato") {
    return "Numero_Contrato";
  }
  if (token.includes("valor contrato media mensal") || token.includes("valor mensal medio contrato")) {
    return "Valor_Mensal_Medio_Contrato";
  }
  if (token.includes("valor cont mensal") || token.includes("valor mensal continuado")) {
    return "Valor_Mensal_Continuado";
  }
  if (token.includes("total estimado anual") || token.includes("total anual estimado")) {
    return "Total_Anual_Estimado";
  }
  if (token === "fonte") return "Fonte";
  if (token.includes("nc detalha")) return "NC_Detalhada";
  if (token.includes("saldo disponivel detalh")) return "Saldo_Disponivel_Detalhado";
  if (token.includes("saldo de empenhos rap") || token.includes("saldo empenhos rap")) {
    return "Saldo_Empenhos_RAP";
  }
  if (token.includes("total rap") && token.includes("empenho")) {
    return "Total_Empenho_RAP";
  }
  if (token.includes("saldo empenhos")) {
    return "Saldo_Empenhos_2025";
  }
  if (token.includes("executado total")) return "Executado_Total";
  if (token.includes("total necessario") || token.includes("valor empenhar")) {
    return "Total_Necessario";
  }
  return null;
};
var scoreHeaderRow = (row) => {
  let score = 0;
  for (const cell of row) {
    const token = normalizeText(cell);
    if (!token) continue;
    if (toMonthKey(cell)) score += 1;
    if (token.includes("descricao das despesas")) score += 4;
    if (token === "ugr") score += 2;
    if (token.startsWith("pi")) score += 2;
    if (mapHeaderTokenToField(token)) score += 2;
  }
  return score;
};
var findHeaderRowIndex = (matrix) => {
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < matrix.length && i < 40; i += 1) {
    const row = matrix[i] || [];
    const score = scoreHeaderRow(row);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestScore >= 8 ? bestIdx : -1;
};
var detectReferenceYear = (monthKeys, rowYearHint) => {
  if (rowYearHint && Number.isFinite(rowYearHint)) return rowYearHint;
  if (monthKeys.length > 0) {
    const first = monthKeys[0];
    const year = Number(first.slice(0, 4));
    return Number.isFinite(year) ? year : null;
  }
  return null;
};
var detectYearFromHeader = (headerRow) => {
  for (const cell of headerRow) {
    if (typeof cell !== "string") continue;
    const match = cell.match(HEADER_PI_YEAR_REGEX);
    if (match && match[1]) {
      const year = Number(match[1]);
      if (Number.isFinite(year)) return year;
    }
  }
  return null;
};
var toIsoDate = (value) => {
  const parsed = parseDateValue(value);
  if (!parsed?.isValid()) return "";
  return parsed.format("YYYY-MM-DD");
};
var sumMonthValues = (row) => {
  return Object.entries(row).reduce((sum, [key, value]) => {
    if (!isMonthKey(key)) return sum;
    return sum + toNumber(value);
  }, 0);
};
var normalizeNumericFields = (row) => {
  const totalEstimado = toNumber(row.Total_Anual_Estimado);
  const executadoInformado = toNumber(row.Executado_Total);
  const empenhoRap = toNumber(row.Total_Empenho_RAP);
  const saldo25 = toNumber(row.Saldo_Empenhos_2025);
  const saldoRap = toNumber(row.Saldo_Empenhos_RAP);
  const meses = sumMonthValues(row);
  const comprometido = empenhoRap || saldo25 + saldoRap;
  const executado = executadoInformado || meses || comprometido;
  const taxaExecucao = totalEstimado > 0 ? executado / totalEstimado * 100 : 0;
  return {
    ...row,
    Total_Anual_Estimado: totalEstimado,
    Valor_Mensal_Medio_Contrato: toNumber(row.Valor_Mensal_Medio_Contrato),
    Valor_Mensal_Continuado: toNumber(row.Valor_Mensal_Continuado),
    Saldo_Empenhos_2025: saldo25,
    Saldo_Empenhos_RAP: saldoRap,
    Total_Empenho_RAP: comprometido,
    Executado_Total: executado,
    Total_Necessario: toNumber(row.Total_Necessario),
    Taxa_Execucao: taxaExecucao
  };
};
var buildUgrAnalysis = (rows) => {
  const map = /* @__PURE__ */ new Map();
  const today = dayjs().startOf("day");
  rows.forEach((row) => {
    const ugrKey = row.UGR || "Nao informado";
    const stats = map.get(ugrKey) || {
      UGR: ugrKey,
      Total_Anual_Estimado: 0,
      Total_Empenho_RAP: 0,
      Executado_Total: 0,
      Comprometido_Total: 0,
      Contratos_Ativos: 0,
      Contratos_Expirados: 0,
      Percentual_Execucao: 0,
      Saldo_Empenhos_2025: 0,
      Saldo_Empenhos_RAP: 0
    };
    const totalEstimado = toNumber(row.Total_Anual_Estimado);
    const executado = toNumber(row.Executado_Total);
    const rap = toNumber(row.Total_Empenho_RAP);
    const saldo25 = toNumber(row.Saldo_Empenhos_2025);
    const saldoRap = toNumber(row.Saldo_Empenhos_RAP);
    const saldo = saldo25 + saldoRap;
    const comprometido = rap > 0 ? rap : saldo;
    const status = String(row.Status_Contrato || "").toUpperCase();
    const vigencia = row.Data_Vigencia_Fim ? parseDateValue(row.Data_Vigencia_Fim) : null;
    stats.Total_Anual_Estimado += totalEstimado;
    stats.Executado_Total += executado;
    stats.Total_Empenho_RAP += comprometido;
    stats.Comprometido_Total += comprometido;
    stats.Saldo_Empenhos_2025 += saldo25;
    stats.Saldo_Empenhos_RAP += saldoRap;
    const isExpired = vigencia && vigencia.isValid() && vigencia.isBefore(today) || status.includes("VENC") && !status.includes("VENCENDO") || status.includes("EXPIRAD");
    if (isExpired) {
      stats.Contratos_Expirados += 1;
    } else {
      stats.Contratos_Ativos += 1;
    }
    map.set(ugrKey, stats);
  });
  return Array.from(map.values()).map((stats) => ({
    ...stats,
    Percentual_Execucao: stats.Total_Anual_Estimado > 0 ? stats.Executado_Total / stats.Total_Anual_Estimado * 100 : 0
  }));
};
var buildMonthlyConsumption = (rows, monthKeys) => {
  return monthKeys.map((monthKey) => ({
    Mes: monthKey,
    M\u00EAs: monthKey.slice(0, 7),
    Consumo_Mensal: rows.reduce((sum, row) => sum + toNumber(row[monthKey]), 0)
  }));
};
var buildContractStatusLists = (rows) => {
  const today = dayjs().startOf("day");
  const expiring = [];
  const expired = [];
  rows.forEach((row) => {
    const status = String(row.Status_Contrato || "").toUpperCase();
    const vigencia = row.Data_Vigencia_Fim ? parseDateValue(row.Data_Vigencia_Fim) : null;
    if (vigencia?.isValid()) {
      const diff = vigencia.startOf("day").diff(today, "day");
      if (diff < 0) {
        expired.push(row);
        return;
      }
      if (diff <= EXPIRING_DAYS) {
        expiring.push(row);
        return;
      }
    }
    if (status.includes("EXPIRAD") || status.includes("VENCIDO")) {
      expired.push(row);
      return;
    }
    if (status.includes("EM BREVE") || status.includes("VENCENDO")) {
      expiring.push(row);
    }
  });
  const sortByDate = (a, b) => {
    const dateA = parseDateValue(a.Data_Vigencia_Fim);
    const dateB = parseDateValue(b.Data_Vigencia_Fim);
    if (!dateA?.isValid() && !dateB?.isValid()) return 0;
    if (!dateA?.isValid()) return 1;
    if (!dateB?.isValid()) return -1;
    return dateA.valueOf() - dateB.valueOf();
  };
  return {
    expiringContracts: expiring.sort(sortByDate),
    expiredContracts: expired.sort(sortByDate)
  };
};
var buildKpis = (rows) => {
  const totalEstimado = rows.reduce((sum, row) => sum + toNumber(row.Total_Anual_Estimado), 0);
  const executado = rows.reduce((sum, row) => sum + toNumber(row.Executado_Total), 0);
  const comprometido = rows.reduce((sum, row) => {
    const rap = toNumber(row.Total_Empenho_RAP);
    const saldo2 = toNumber(row.Saldo_Empenhos_2025) + toNumber(row.Saldo_Empenhos_RAP);
    return sum + (rap > 0 ? rap : saldo2);
  }, 0);
  const saldo = Math.max(totalEstimado - executado, 0);
  const percentual = totalEstimado > 0 ? executado / totalEstimado * 100 : 0;
  const today = dayjs().startOf("day");
  let expiring = 0;
  let expired = 0;
  rows.forEach((row) => {
    const vigencia = row.Data_Vigencia_Fim ? parseDateValue(row.Data_Vigencia_Fim) : null;
    const status = String(row.Status_Contrato || "").toUpperCase();
    if (vigencia?.isValid()) {
      const diff = vigencia.startOf("day").diff(today, "day");
      if (diff < 0) {
        expired += 1;
      } else if (diff <= EXPIRING_DAYS) {
        expiring += 1;
      }
      return;
    }
    if (status.includes("EXPIRAD") || status.includes("VENCIDO")) {
      expired += 1;
    } else if (status.includes("EM BREVE") || status.includes("VENCENDO")) {
      expiring += 1;
    }
  });
  return {
    total_anual_estimado: totalEstimado,
    total_empenhado: executado,
    total_comprometido: comprometido,
    saldo_a_empenhar: saldo,
    percentual_execucao: percentual,
    taxa_execucao: percentual,
    count_expiring_contracts: expiring,
    count_expired_contracts: expired
  };
};
var shouldDiscardRow = (row, monthKeys) => {
  const description = normalizeToken(row.Despesa || row["Descri\xE7\xE3o das despesas"]);
  const ugr = normalizeToken(row.UGR || row.ugr);
  const pi = normalizeToken(row.PI || row.PI_2025 || row.pi);
  if (description === "data de atualizacao") return true;
  if (description === "total" || description === "total geral") return true;
  if (description.startsWith("total da") || description.startsWith("total de")) return true;
  if (description.startsWith("total ") && !ugr) return true;
  const hasFinancial = toNumber(row.Total_Anual_Estimado) > 0 || toNumber(row.Total_Empenho_RAP) > 0 || toNumber(row.Saldo_Empenhos_2025) > 0 || toNumber(row.Saldo_Empenhos_RAP) > 0 || toNumber(row.Total_Necessario) > 0 || monthKeys.some((key) => toNumber(row[key]) > 0);
  const hasCoreInfo = Boolean(description || ugr || pi || normalizeToken(row["n\xBA  Contrato"]));
  return !hasCoreInfo && !hasFinancial;
};
var getLooseRowMonthKeys = (row) => {
  const keys = [];
  Object.keys(row).forEach((rawKey) => {
    const trimmed = rawKey.trim();
    if (isMonthKey(trimmed)) {
      keys.push(normalizeMonthKey(trimmed));
      return;
    }
    const monthKey = toMonthKey(trimmed);
    if (monthKey) {
      keys.push(monthKey);
    }
  });
  return keys;
};
var coerceCanonicalRow = (looseRow, monthKeysFromDataset, referenceYearHint) => {
  const piKey = Object.keys(looseRow).find((key) => /^PI_20\d{2}$/i.test(key));
  const despesa = maybeString(
    firstDefined(
      looseRow.Despesa,
      looseRow.despesa,
      looseRow["Descri\xE7\xE3o das despesas"],
      looseRow.descricao,
      looseRow["Acompanhamento de Contratos*"]
    )
  );
  const piValue = maybeString(
    firstDefined(
      looseRow.PI,
      looseRow.pi,
      looseRow.PI_2025,
      piKey ? looseRow[piKey] : void 0,
      looseRow["PI 2025"],
      looseRow["PI 2026"],
      looseRow["PI 2027"],
      looseRow["PI 2028"]
    )
  );
  const coerced = {
    Despesa: despesa,
    "Descri\xE7\xE3o das despesas": despesa,
    UGR: maybeString(firstDefined(looseRow.UGR, looseRow.ugr)),
    PI: piValue,
    PI_2025: piValue,
    CNPJ: maybeString(firstDefined(looseRow.CNPJ, looseRow.cnpj)),
    Processo: maybeString(firstDefined(looseRow.Processo, looseRow.processo)),
    Data_Vigencia_Fim: toIsoDate(
      firstDefined(looseRow.Data_Vigencia_Fim, looseRow["Vig\xEAncia"], looseRow.vigencia)
    ),
    Status_Contrato: maybeString(
      firstDefined(looseRow.Status_Contrato, looseRow["Status do Contrato"], looseRow.status)
    ),
    Situacao_Prorrogacao: maybeString(
      firstDefined(
        looseRow.Situacao_Prorrogacao,
        looseRow["Situa\xE7\xE3o da prorroga\xE7\xE3o"],
        looseRow["Situa\xE7\xE3o da Prorroga\xE7\xE3o"]
      )
    ),
    "n\xBA  Contrato": maybeString(
      firstDefined(looseRow["n\xBA  Contrato"], looseRow.Numero_Contrato, looseRow["N\xBA Contrato"])
    ),
    Valor_Mensal_Medio_Contrato: toNumber(
      firstDefined(
        looseRow.Valor_Mensal_Medio_Contrato,
        looseRow["Valor Contrato M\xE9dia mensal"],
        looseRow["Valor contrato m\xE9dia mensal"]
      )
    ),
    Valor_Mensal_Continuado: toNumber(
      firstDefined(looseRow.Valor_Mensal_Continuado, looseRow["Valor Cont Mensal "])
    ),
    Total_Anual_Estimado: toNumber(
      firstDefined(looseRow.Total_Anual_Estimado, looseRow["Total estimado Anual"])
    ),
    Fonte: maybeString(firstDefined(looseRow.Fonte, looseRow.fonte)),
    NC_Detalhada: maybeString(firstDefined(looseRow.NC_Detalhada, looseRow["NC detalhada"], looseRow["NC detalhado"])),
    Saldo_Disponivel_Detalhado: toNumber(
      firstDefined(looseRow.Saldo_Disponivel_Detalhado, looseRow["Saldo Dispon\xEDvel Detalhado"])
    ),
    Saldo_Empenhos_2025: toNumber(
      firstDefined(looseRow.Saldo_Empenhos_2025, looseRow["Saldo Empenhos 2025"])
    ),
    Saldo_Empenhos_RAP: toNumber(
      firstDefined(looseRow.Saldo_Empenhos_RAP, looseRow["Saldo de Empenhos RAP"])
    ),
    Total_Empenho_RAP: toNumber(
      firstDefined(looseRow.Total_Empenho_RAP, looseRow["Total RAP + Empenho"])
    ),
    Executado_Total: toNumber(firstDefined(looseRow.Executado_Total, looseRow.executado_total)),
    Total_Necessario: toNumber(
      firstDefined(looseRow.Total_Necessario, looseRow["Total necess\xE1rio"], looseRow["Valor  Empenhar"])
    )
  };
  const allMonthKeys = new Set(monthKeysFromDataset);
  getLooseRowMonthKeys(looseRow).forEach((key) => allMonthKeys.add(key));
  allMonthKeys.forEach((monthKey) => {
    const directValue = looseRow[monthKey];
    const looseValue = looseRow[monthKey.replace(" 00:00:00", "")];
    coerced[monthKey] = toNumber(firstDefined(directValue, looseValue));
  });
  const referenceYear = detectReferenceYear(Array.from(allMonthKeys), referenceYearHint ?? null);
  if (referenceYear) {
    coerced[`PI_${referenceYear}`] = piValue;
  }
  return normalizeNumericFields(coerced);
};
var parseSheet = (sheetName, worksheet) => {
  const matrix = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: true
  });
  const headerRowIndex = findHeaderRowIndex(matrix);
  if (headerRowIndex < 0) return null;
  const headerRow = matrix[headerRowIndex] || [];
  const headerScore = scoreHeaderRow(headerRow);
  const bindings = /* @__PURE__ */ new Map();
  const monthKeys = /* @__PURE__ */ new Set();
  headerRow.forEach((cell, colIdx) => {
    const monthKey = toMonthKey(cell);
    if (monthKey) {
      bindings.set(colIdx, { type: "month", monthKey });
      monthKeys.add(monthKey);
      return;
    }
    const token = normalizeText(cell);
    const field = mapHeaderTokenToField(token);
    if (field) {
      bindings.set(colIdx, { type: "field", field });
    }
  });
  const referenceYear = detectYearFromHeader(headerRow);
  const parsedRows = [];
  for (let rowIdx = headerRowIndex + 1; rowIdx < matrix.length; rowIdx += 1) {
    const row = matrix[rowIdx] || [];
    const mapped = {};
    bindings.forEach((binding, colIdx) => {
      const value = row[colIdx];
      if (binding.type === "month") {
        mapped[binding.monthKey] = value;
        return;
      }
      mapped[binding.field] = value;
    });
    const canonicalRow = coerceCanonicalRow(mapped, Array.from(monthKeys), referenceYear);
    if (shouldDiscardRow(canonicalRow, Array.from(monthKeys))) {
      continue;
    }
    parsedRows.push(canonicalRow);
  }
  return {
    headerRowIndex,
    headerScore,
    monthKeys: Array.from(monthKeys).sort(),
    referenceYear,
    rows: parsedRows,
    sheetName
  };
};
var pickSheet = (workbook, preferredSheet) => {
  const sheetNames = workbook.SheetNames;
  const orderedCandidates = [preferredSheet, ...PREFERRED_SHEETS, ...sheetNames].filter(
    (name, idx, arr) => Boolean(name) && arr.indexOf(name) === idx
  );
  let best = null;
  for (const sheetName of orderedCandidates) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const parsed = parseSheet(sheetName, sheet);
    if (!parsed) continue;
    if (!best) {
      best = parsed;
    } else {
      const currentScore = parsed.headerScore * 1e3 + parsed.rows.length;
      const bestScore = best.headerScore * 1e3 + best.rows.length;
      if (currentScore > bestScore) {
        best = parsed;
      }
    }
    if (parsed.rows.length > 0 && (sheetName === preferredSheet || PREFERRED_SHEETS.includes(sheetName))) {
      return parsed;
    }
  }
  if (!best) {
    throw new Error("Nao foi possivel identificar uma aba valida na planilha.");
  }
  return best;
};
var extractMonthKeys = (rows, metadataMonthKeys) => {
  const keys = /* @__PURE__ */ new Set();
  if (Array.isArray(metadataMonthKeys)) {
    metadataMonthKeys.filter((key) => typeof key === "string").forEach((key) => {
      if (isMonthKey(key)) {
        keys.add(normalizeMonthKey(key));
      }
    });
  }
  rows.forEach((row) => {
    Object.keys(row).forEach((rawKey) => {
      const key = rawKey.trim();
      if (isMonthKey(key)) {
        keys.add(normalizeMonthKey(key));
        return;
      }
      const monthKey = toMonthKey(key);
      if (monthKey) {
        keys.add(monthKey);
      }
    });
  });
  return Array.from(keys).sort();
};
var mergeDashboardData = (currentData, newData) => {
  if (!currentData || !Array.isArray(currentData.raw_data_for_filters)) {
    return newData;
  }
  const currentRows = currentData.raw_data_for_filters;
  const newRows = newData.raw_data_for_filters;
  const currentMap = /* @__PURE__ */ new Map();
  currentRows.forEach((row) => {
    const pi = normalizeToken(row.PI || row.PI_2025);
    if (pi) {
      currentMap.set(pi, row);
    }
  });
  const mergedRows = [];
  const processedPIs = /* @__PURE__ */ new Set();
  newRows.forEach((newRow) => {
    const pi = normalizeToken(newRow.PI || newRow.PI_2025);
    if (pi && currentMap.has(pi)) {
      const oldRow = currentMap.get(pi);
      const mergedRow = { ...oldRow, ...newRow };
      const fixedFields = ["Despesa", "UGR", "CNPJ", "Processo", "n\xBA  Contrato", "Fonte", "Status_Contrato"];
      fixedFields.forEach((field) => {
        if (isNullishLike(newRow[field]) && !isNullishLike(oldRow[field])) {
          mergedRow[field] = oldRow[field];
        }
      });
      mergedRows.push(mergedRow);
      processedPIs.add(pi);
    } else {
      mergedRows.push(newRow);
      if (pi) processedPIs.add(pi);
    }
  });
  currentRows.forEach((oldRow) => {
    const pi = normalizeToken(oldRow.PI || oldRow.PI_2025);
    if (!pi || !processedPIs.has(pi)) {
      mergedRows.push(oldRow);
    }
  });
  const allMonthKeys = /* @__PURE__ */ new Set([
    ...currentData.metadata?.month_keys || [],
    ...newData.metadata?.month_keys || []
  ]);
  return normalizeDashboardData({
    raw_data_for_filters: mergedRows,
    metadata: {
      ...currentData.metadata,
      ...newData.metadata,
      // Prefer new metadata (filenames, dates)
      month_keys: Array.from(allMonthKeys).sort(),
      updated_at: dayjs().toISOString()
      // Always update timestamp
    }
  });
};
var normalizeDashboardData = (payload) => {
  const sourceRows = Array.isArray(payload?.raw_data_for_filters) ? payload.raw_data_for_filters : [];
  const metadataMonthKeys = Array.isArray(payload?.metadata?.month_keys) ? payload.metadata.month_keys : void 0;
  const monthKeys = extractMonthKeys(sourceRows, metadataMonthKeys);
  const rows = sourceRows.map((row) => coerceCanonicalRow(row, monthKeys, payload?.metadata?.reference_year)).filter((row) => !shouldDiscardRow(row, monthKeys)).map((row) => normalizeNumericFields(row));
  const normalizedMonthKeys = monthKeys.length > 0 ? monthKeys : extractMonthKeys(rows);
  const ugrAnalysis = buildUgrAnalysis(rows);
  const computedKpis = buildKpis(rows);
  const monthlyConsumption2 = buildMonthlyConsumption(rows, normalizedMonthKeys);
  const { expiringContracts, expiredContracts } = buildContractStatusLists(rows);
  const referenceYear = detectReferenceYear(
    normalizedMonthKeys,
    payload?.metadata?.reference_year ?? payload?.reference_year ?? null
  );
  return {
    ...payload,
    raw_data_for_filters: rows,
    ugr_analysis: ugrAnalysis,
    monthly_consumption: monthlyConsumption2,
    expiring_contracts_list: expiringContracts,
    expired_contracts_list: expiredContracts,
    kpis: {
      ...payload?.kpis || {},
      ...computedKpis
    },
    metadata: {
      ...payload?.metadata || {},
      month_keys: normalizedMonthKeys,
      reference_year: referenceYear,
      updated_at: payload?.metadata?.updated_at || dayjs().toISOString()
    }
  };
};
var parseDashboardExcel = (buffer, options) => {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: true
  });
  const selectedSheet = pickSheet(workbook, options?.preferredSheet);
  const normalized = normalizeDashboardData({
    raw_data_for_filters: selectedSheet.rows,
    metadata: {
      source_file_name: options?.fileName,
      source_sheet: selectedSheet.sheetName,
      workbook_sheets: workbook.SheetNames,
      month_keys: selectedSheet.monthKeys,
      reference_year: detectReferenceYear(selectedSheet.monthKeys, selectedSheet.referenceYear),
      updated_at: dayjs().toISOString()
    }
  });
  return normalized;
};

// server/routers.ts
var DASHBOARD_DATA_PATH = path.join(process.cwd(), "dashboard_data.json");
var dashboardData = null;
var dashboardDataMtime = 0;
function loadDashboardData() {
  try {
    const stats = fs.statSync(DASHBOARD_DATA_PATH);
    const mtime = stats.mtimeMs;
    if (!dashboardData || dashboardDataMtime !== mtime) {
      const fileContent = fs.readFileSync(DASHBOARD_DATA_PATH, "utf-8");
      const payload = JSON.parse(fileContent);
      dashboardData = normalizeDashboardData(payload);
      dashboardDataMtime = mtime;
    }
    return dashboardData;
  } catch (error) {
    console.error("Error loading dashboard data:", error);
    return EMPTY_DASHBOARD_DATA;
  }
}
var emendasData = null;
var emendasDataMtime = 0;
function loadEmendasData() {
  try {
    const dataPath = path.join(process.cwd(), "emendas_dashboard_data.json");
    if (!fs.existsSync(dataPath)) {
      return {
        kpis: {
          credito_disponivel: 0,
          despesas_empenhadas: 0,
          saldo_disponivel: 0,
          percentual_execucao: 0,
          dotacao_loa: 0,
          valor_bloqueado: 0,
          valor_contingenciado: 0
        },
        rows: [],
        campus_breakdown: []
      };
    }
    const stats = fs.statSync(dataPath);
    const mtime = stats.mtimeMs;
    if (!emendasData || emendasDataMtime !== mtime) {
      const fileContent = fs.readFileSync(dataPath, "utf-8");
      emendasData = JSON.parse(fileContent);
      emendasDataMtime = mtime;
    }
    return emendasData;
  } catch (error) {
    console.error("Error loading emendas dashboard data:", error);
    return {
      kpis: {
        credito_disponivel: 0,
        despesas_empenhadas: 0,
        saldo_disponivel: 0,
        percentual_execucao: 0,
        dotacao_loa: 0,
        valor_bloqueado: 0,
        valor_contingenciado: 0
      },
      rows: [],
      campus_breakdown: []
    };
  }
}
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  }),
  budget: router({
    getKPIs: publicProcedure.query(async () => {
      const data = loadDashboardData();
      return data.kpis;
    }),
    getMetadata: publicProcedure.query(async () => {
      const data = loadDashboardData();
      return data.metadata;
    }),
    getUGRAnalysis: publicProcedure.query(async () => {
      const data = loadDashboardData();
      return data.ugr_analysis || [];
    }),
    getMonthlyConsumption: publicProcedure.query(async () => {
      const data = loadDashboardData();
      return data.monthly_consumption || [];
    }),
    getExpiringContracts: publicProcedure.query(async () => {
      const data = loadDashboardData();
      return data.expiring_contracts_list || [];
    }),
    getExpiredContracts: publicProcedure.query(async () => {
      const data = loadDashboardData();
      return data.expired_contracts_list || [];
    }),
    getAllData: publicProcedure.query(async () => {
      const data = loadDashboardData();
      return data.raw_data_for_filters || [];
    }),
    uploadFile: publicProcedure.input(
      z2.object({
        contentBase64: z2.string().min(1, "Arquivo vazio"),
        fileName: z2.string().min(1, "Nome do arquivo ausente"),
        preferredSheet: z2.string().trim().min(1).optional()
      })
    ).mutation(async ({ input }) => {
      try {
        const buffer = Buffer.from(input.contentBase64, "base64");
        if (buffer.length === 0) {
          return {
            success: false,
            message: "Nao foi possivel ler o arquivo enviado."
          };
        }
        const maxBytes = 25 * 1024 * 1024;
        if (buffer.length > maxBytes) {
          return {
            success: false,
            message: "Arquivo maior que 25MB. Reduza o tamanho e tente novamente."
          };
        }
        const normalizedPayload = parseDashboardExcel(buffer, {
          fileName: input.fileName,
          preferredSheet: input.preferredSheet
        });
        const existingData = loadDashboardData();
        const mergedPayload = mergeDashboardData(existingData, normalizedPayload);
        fs.writeFileSync(DASHBOARD_DATA_PATH, JSON.stringify(mergedPayload, null, 2), "utf-8");
        dashboardData = mergedPayload;
        dashboardDataMtime = fs.statSync(DASHBOARD_DATA_PATH).mtimeMs;
        return {
          success: true,
          message: "Dados combinados e atualizados com sucesso.",
          metadata: mergedPayload.metadata || {},
          rowsImported: Array.isArray(mergedPayload.raw_data_for_filters) ? mergedPayload.raw_data_for_filters.length : 0
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao processar planilha";
        console.error("Error uploading dashboard data:", error);
        return {
          success: false,
          message
        };
      }
    })
  }),
  emendas: router({
    getKPIs: publicProcedure.query(async () => {
      const data = loadEmendasData();
      return data.kpis || {};
    }),
    getAllData: publicProcedure.query(async () => {
      const data = loadEmendasData();
      return data.rows || [];
    }),
    getCampusBreakdown: publicProcedure.query(async () => {
      const data = loadEmendasData();
      return data.campus_breakdown || [];
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid } from "nanoid";
import path3 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path2 from "path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime()];
var vite_config_default = defineConfig({
  // When the app is deployed under Saiku at /dashboard, set the base so
  // built asset URLs point to /dashboard/* instead of /. This ensures the
  // SPA and its assets load correctly when served from the host app.
  base: "/dashboard/",
  plugins,
  resolve: {
    alias: {
      "@": path2.resolve(import.meta.dirname, "client", "src"),
      "@shared": path2.resolve(import.meta.dirname, "shared"),
      "@assets": path2.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path2.resolve(import.meta.dirname),
  root: path2.resolve(import.meta.dirname, "client"),
  publicDir: path2.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path2.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path3.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path3.resolve(import.meta.dirname, "../..", "dist", "public") : path3.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path3.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
