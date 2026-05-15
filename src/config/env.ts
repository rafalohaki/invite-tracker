import { z } from 'zod';

const csvSchema = z
    .string()
    .optional()
    .transform((raw) =>
        (raw ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    );

const boolSchema = z
    .string()
    .optional()
    .transform((raw) => raw === 'true' || raw === '1');

const envSchema = z.object({
    DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
    CLIENT_ID: z.string().min(1, 'CLIENT_ID is required'),
    TEST_GUILD_ID: z.string().optional(),

    ADMIN_IDS: csvSchema,

    LOG_LEVEL: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),

    DATABASE_PATH: z.string().default('./invites.db'),

    LOCALE_LANG: z.enum(['en', 'custom']).default('en'),

    VALIDATION_PERIOD_DAYS: z.coerce.number().int().min(0).max(365).default(7),
    VALIDATION_CHECK_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),

    ANTI_CHEAT_WINDOW_DAYS: z.coerce.number().int().min(0).max(365).default(30),

    PERFORM_GUILD_DELETE_CLEANUP: boolSchema,
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
        const issues = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
        // eslint-disable-next-line no-console -- logger isn't loaded yet at env-parse time
        console.error(`FATAL: Invalid environment variables:\n${issues}`);
        process.exit(1);
    }
    return result.data;
}

export const env: Env = parseEnv();
