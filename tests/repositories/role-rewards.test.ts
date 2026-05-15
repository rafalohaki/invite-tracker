import { beforeEach, describe, expect, it } from 'bun:test';
import { RoleRewardsRepository } from '@/db/repositories/role-rewards.ts';
import { createTestDb } from '../helpers/in-memory-db.ts';

describe('RoleRewardsRepository', () => {
    let repo: RoleRewardsRepository;

    beforeEach(() => {
        repo = new RoleRewardsRepository(createTestDb());
    });

    it('add + listForGuild round-trips, sorted by threshold ascending', () => {
        repo.add('g1', 25, 'roleVeteran');
        repo.add('g1', 5, 'roleRecruiter');
        repo.add('g1', 100, 'roleLegend');
        const list = repo.listForGuild('g1');
        expect(list.map((r) => r.threshold)).toEqual([5, 25, 100]);
    });

    it('UNIQUE (guildId, threshold) prevents duplicates', () => {
        repo.add('g1', 5, 'role1');
        expect(() => repo.add('g1', 5, 'role2')).toThrow();
    });

    it('same threshold across different guilds is allowed', () => {
        repo.add('g1', 5, 'role1');
        expect(() => repo.add('g2', 5, 'role2')).not.toThrow();
    });

    it('same roleId across different thresholds is allowed', () => {
        repo.add('g1', 5, 'role1');
        expect(() => repo.add('g1', 10, 'role1')).not.toThrow();
    });

    it('CHECK threshold > 0 rejects zero and negative values', () => {
        expect(() => repo.add('g1', 0, 'role')).toThrow();
        expect(() => repo.add('g1', -1, 'role')).toThrow();
    });

    it('removeByThreshold returns 1 on hit, 0 on miss', () => {
        repo.add('g1', 5, 'role1');
        expect(repo.removeByThreshold('g1', 5)).toBe(1);
        expect(repo.removeByThreshold('g1', 5)).toBe(0);
    });

    it('findEligibleForCount returns rewards with threshold ≤ count', () => {
        repo.add('g1', 1, 'role1');
        repo.add('g1', 5, 'role5');
        repo.add('g1', 25, 'role25');
        const eligible = repo.findEligibleForCount('g1', 7);
        expect(eligible.map((r) => r.threshold)).toEqual([1, 5]);
    });

    it('deleteAllInGuild removes only the target guild', () => {
        repo.add('g1', 5, 'role1');
        repo.add('g2', 5, 'role2');
        expect(repo.deleteAllInGuild('g1')).toBe(1);
        expect(repo.listForGuild('g1')).toEqual([]);
        expect(repo.listForGuild('g2').length).toBe(1);
    });
});
