import {
    type CommandInteraction,
    type InteractionEditReplyOptions,
    type InteractionReplyOptions,
    MessageFlags,
} from 'discord.js';
import { logError } from '@/utils/logger.ts';

/**
 * Send a reply that works regardless of interaction state (not-yet-replied, deferred, replied).
 *
 * - Not yet replied → `reply(...)` with ephemeral flag (default true).
 * - Already deferred → `editReply(...)` (ephemeral was set at defer time, cannot change here).
 * - Already replied (rare error path) → `followUp(...)` with ephemeral flag.
 *
 * Catches and logs send failures (e.g. interaction token expired) instead of throwing —
 * an error reply that itself errors should not crash the command handler.
 */
export async function sendSafeReply(
    interaction: CommandInteraction,
    content: string,
    options: { ephemeral?: boolean } = {},
): Promise<void> {
    const ephemeral = options.ephemeral ?? true;
    const flags = ephemeral ? MessageFlags.Ephemeral : undefined;

    try {
        if (interaction.deferred && !interaction.replied) {
            const payload: InteractionEditReplyOptions = { content, embeds: [] };
            await interaction.editReply(payload);
            return;
        }
        if (interaction.replied) {
            const payload: InteractionReplyOptions = flags !== undefined ? { content, flags } : { content };
            await interaction.followUp(payload);
            return;
        }
        const payload: InteractionReplyOptions = flags !== undefined ? { content, flags } : { content };
        await interaction.reply(payload);
    } catch (err) {
        logError('[safe-reply] Failed to send response to interaction:', err);
    }
}
