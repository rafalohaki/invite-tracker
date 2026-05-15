import { Events, MessageFlags } from 'discord.js';
import { t } from '@/i18n/translator.ts';
import type { AppClient } from '@/types/discord.ts';
import { logDebug, logError } from '@/utils/logger.ts';

export function registerInteractionCreate(client: AppClient): void {
    client.on(Events.InteractionCreate, async (interaction) => {
        const logPrefix = `[Interaction][User:${interaction.user.id}][Guild:${interaction.guildId ?? 'N/A'}]`;

        // Autocomplete first (cheap, no defer).
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (!command?.autocomplete) return;
            try {
                await command.autocomplete(interaction);
            } catch (err) {
                logError(`${logPrefix} autocomplete failed for /${interaction.commandName}:`, err);
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);
        if (!command) {
            logError(`${logPrefix} no command registered for /${interaction.commandName}`);
            await interaction
                .reply({ content: t('general.error_unknown_command'), flags: MessageFlags.Ephemeral })
                .catch(() => {});
            return;
        }

        try {
            logDebug(`${logPrefix} executing /${interaction.commandName}`);
            await command.execute(interaction);
        } catch (err) {
            logError(`${logPrefix} uncaught error in /${interaction.commandName}:`, err);
            const errorMessage = t('general.error_command_execution');
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
                }
            } catch (replyErr) {
                logError(`${logPrefix} failed to send error reply:`, replyErr);
            }
        }
    });
}
