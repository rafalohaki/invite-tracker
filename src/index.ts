import { env } from '@/config/env.ts';
import { configuredLogLevel, logInfo } from '@/utils/logger.ts';

logInfo('bot starting');
logInfo(`[Config] Log Level: ${configuredLogLevel()}`);
logInfo(`[Config] Database: ${env.DATABASE_PATH}`);
logInfo(`[Config] Locale: ${env.LOCALE_LANG}`);
logInfo(
    `[Config] Validation: every ${env.VALIDATION_CHECK_INTERVAL_MINUTES}min, period ${env.VALIDATION_PERIOD_DAYS}d`,
);
logInfo(`[Config] Anti-cheat window: ${env.ANTI_CHEAT_WINDOW_DAYS}d`);
logInfo('Scaffold OK — full bot implementation arrives in next PRs.');
