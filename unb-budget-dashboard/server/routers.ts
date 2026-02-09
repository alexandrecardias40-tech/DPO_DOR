import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { COOKIE_NAME } from '@shared/const';
import { getSessionCookieOptions } from './_core/cookies';
import { systemRouter } from './_core/systemRouter';
import { publicProcedure, router } from './_core/trpc';
import { EMPTY_DASHBOARD_DATA, normalizeDashboardData, parseDashboardExcel, mergeDashboardData } from './budgetData';

const DASHBOARD_DATA_PATH = path.join(process.cwd(), 'dashboard_data.json');

// Load dashboard data once
let dashboardData: any = null;
let dashboardDataMtime = 0;

function loadDashboardData() {
  try {
    const stats = fs.statSync(DASHBOARD_DATA_PATH);
    const mtime = stats.mtimeMs;

    if (!dashboardData || dashboardDataMtime !== mtime) {
      const fileContent = fs.readFileSync(DASHBOARD_DATA_PATH, 'utf-8');
      const payload = JSON.parse(fileContent);
      dashboardData = normalizeDashboardData(payload);
      dashboardDataMtime = mtime;
    }

    return dashboardData;
  } catch (error) {
    console.error('Error loading dashboard data:', error);
    return EMPTY_DASHBOARD_DATA;
  }
}

let emendasData: any = null;
let emendasDataMtime = 0;

function loadEmendasData() {
  try {
    const dataPath = path.join(process.cwd(), 'emendas_dashboard_data.json');
    if (!fs.existsSync(dataPath)) {
      return {
        kpis: {
          credito_disponivel: 0,
          despesas_empenhadas: 0,
          saldo_disponivel: 0,
          percentual_execucao: 0,
          dotacao_loa: 0,
          valor_bloqueado: 0,
          valor_contingenciado: 0,
        },
        rows: [],
        campus_breakdown: [],
      };
    }
    const stats = fs.statSync(dataPath);
    const mtime = stats.mtimeMs;

    if (!emendasData || emendasDataMtime !== mtime) {
      const fileContent = fs.readFileSync(dataPath, 'utf-8');
      emendasData = JSON.parse(fileContent);
      emendasDataMtime = mtime;
    }
    return emendasData;
  } catch (error) {
    console.error('Error loading emendas dashboard data:', error);
    return {
      kpis: {
        credito_disponivel: 0,
        despesas_empenhadas: 0,
        saldo_disponivel: 0,
        percentual_execucao: 0,
        dotacao_loa: 0,
        valor_bloqueado: 0,
        valor_contingenciado: 0,
      },
      rows: [],
      campus_breakdown: [],
    };
  }
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
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

    uploadFile: publicProcedure
      .input(
        z.object({
          contentBase64: z.string().min(1, 'Arquivo vazio'),
          fileName: z.string().min(1, 'Nome do arquivo ausente'),
          preferredSheet: z.string().trim().min(1).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        try {
          const buffer = Buffer.from(input.contentBase64, 'base64');
          if (buffer.length === 0) {
            return {
              success: false,
              message: 'Nao foi possivel ler o arquivo enviado.',
            };
          }

          const maxBytes = 25 * 1024 * 1024;
          if (buffer.length > maxBytes) {
            return {
              success: false,
              message: 'Arquivo maior que 25MB. Reduza o tamanho e tente novamente.',
            };
          }

          const normalizedPayload = parseDashboardExcel(buffer, {
            fileName: input.fileName,
            preferredSheet: input.preferredSheet,
          });

          // Load existing data to merge
          const existingData = loadDashboardData();

          // Perform Smart Merge
          const mergedPayload = mergeDashboardData(existingData, normalizedPayload);

          fs.writeFileSync(DASHBOARD_DATA_PATH, JSON.stringify(mergedPayload, null, 2), 'utf-8');

          dashboardData = mergedPayload;
          dashboardDataMtime = fs.statSync(DASHBOARD_DATA_PATH).mtimeMs;

          return {
            success: true,
            message: 'Dados combinados e atualizados com sucesso.',
            metadata: mergedPayload.metadata || {},
            rowsImported: Array.isArray(mergedPayload.raw_data_for_filters)
              ? mergedPayload.raw_data_for_filters.length
              : 0,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Erro ao processar planilha';
          console.error('Error uploading dashboard data:', error);
          return {
            success: false,
            message,
          };
        }
      }),
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
    }),
  }),
});

export type AppRouter = typeof appRouter;
