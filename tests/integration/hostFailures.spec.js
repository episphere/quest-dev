import { describe, expect, it, vi } from 'vitest';
import { renderFreshQuest } from '../helpers/questRuntime.js';

async function answerAndAdvance(quest) {
  quest.root.querySelector('#Q1_1').click();
  quest.root.querySelector('#Q1 .next').click();
  await vi.waitFor(() => expect(quest.store).toHaveBeenCalled());
}

describe('host boundary success, delay, and failure behavior', () => {
  it('advances immediately while a delayed successful host write settles', async () => {
    const quest = await renderFreshQuest({ storeDelay: 150 });

    await answerAndAdvance(quest);
    expect(quest.root.querySelector('form.active')?.id).toBe('Q2');
    await vi.waitFor(() => expect(quest.calls.store).toHaveLength(1));
    expect(quest.errors).toEqual([]);
  });

  it.each(['non200', 'reject'])('rolls back navigation and shows a recoverable modal after a %s store result', async (storeMode) => {
    const quest = await renderFreshQuest({ storeMode });

    await answerAndAdvance(quest);
    await vi.waitFor(() => expect(quest.root.querySelector('form.active')?.id).toBe('Q1'));

    expect(quest.root.querySelector('#storeErrorModal').classList).toContain('show');
    expect(quest.errors.flat().join(' ')).toContain('Error syncing state to store');
  });

  it('logs a rejected retrieve operation and still starts a clean survey', async () => {
    const retrieve = vi.fn(async () => {
      throw new Error('Configured retrieve rejection');
    });
    const quest = await renderFreshQuest({ params: { retrieve } });

    expect(quest.rendered).toBe(true);
    expect(quest.root.querySelector('form.active')?.id).toBe('Q1');
    expect(quest.errors.flat().join(' ')).toContain('Error fetching retrieve function and css');
  });
});
