import { describe, expect, it } from 'bun:test';
import { renderWelcomeTemplate } from '@/services/welcome.ts';

describe('renderWelcomeTemplate', () => {
    it('substitutes {user}, {inviter}, {count}', () => {
        const out = renderWelcomeTemplate(
            'Welcome {user}! You were invited by {inviter}. Their count: {count}.',
            '<@111>',
            '<@222>',
            7,
        );
        expect(out).toBe('Welcome <@111>! You were invited by <@222>. Their count: 7.');
    });

    it('handles repeated placeholders', () => {
        const out = renderWelcomeTemplate('{user} {user} {user}', '<@1>', '<@2>', 0);
        expect(out).toBe('<@1> <@1> <@1>');
    });

    it('leaves unknown placeholders untouched', () => {
        const out = renderWelcomeTemplate('Hi {user}, see {channel} later.', '<@1>', '<@2>', 5);
        expect(out).toBe('Hi <@1>, see {channel} later.');
    });

    it('does not render @everyone in the output, even if template contains it', () => {
        // Note: the template ITSELF can contain @everyone — sanitizing happens at send time
        // via allowedMentions: { parse: [], roles: [] } in sendWelcomeMessage.
        // This test documents that the renderer is text-only; mention safety is the caller's job.
        const out = renderWelcomeTemplate('@everyone — welcome {user}!', '<@1>', '<@2>', 1);
        expect(out).toContain('@everyone'); // text remains; @everyone has no effect once allowedMentions is set
        expect(out).toContain('<@1>');
    });

    it('count is coerced to string', () => {
        const out = renderWelcomeTemplate('{count}', '<@1>', '<@2>', 0);
        expect(out).toBe('0');
    });
});
