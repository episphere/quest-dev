import { describe, expect, it } from 'vitest';

import { renderFreshQuest } from '../helpers/questRuntime.js';
import { readLockedMarkdown } from '../e2e/support/corpus.js';

const conditionalCompoundQuestionIds = [
  'D_733638576',
  'D_532260562',
  'D_440093675',
  'D_786253125',
  'D_968388901',
  'D_679430807',
  'D_135529881',
  'D_219317801',
];

const indentedResponseQuestionIds = new Set([
  'D_135529881',
  'D_219317801',
]);

const expectedDurationValues = [
  '428999623',
  '248303092',
  '998679771',
  '638092100',
  '127455035',
];

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function safelyDecodeCondition(value) {
  let decoded = String(value ?? '').trim();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      break;
    }
    if (next === decoded) break;
    decoded = next;
  }

  return normalizeText(decoded);
}

function lockedQuestionBlock(markdown, questionId) {
  const lines = markdown.split(/\r?\n/);
  const header = new RegExp(`^\\[${questionId}(?:[?!])?(?=\\||,|\\])`);
  const nextHeader = /^\[[A-Z_][A-Z0-9_#]*[?!]?(?=\||,|\])/;
  const start = lines.findIndex((line) => header.test(line));
  expect(start, `Locked Module 4 must contain ${questionId}`).toBeGreaterThanOrEqual(0);

  const relativeEnd = lines.slice(start + 1).findIndex((line) => nextHeader.test(line));
  const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start, end);
}

function authoredCompoundGroups(questionLines, questionId) {
  const promptPattern = /^\s*\|displayif=(.+?)\|\s*(.*?)\|\s*$/;
  const responsePattern = /^\s*\((\d+):([A-Z_][A-Z0-9_#]*),displayif=(.+)\)\s+(.+?)\s*$/;
  const groups = [];
  const groupsByName = new Map();
  let currentPrompt = null;

  for (const line of questionLines.slice(1)) {
    const promptMatch = line.match(promptPattern);
    if (promptMatch) {
      currentPrompt = {
        condition: safelyDecodeCondition(promptMatch[1]),
        text: normalizeText(promptMatch[2]),
      };
      continue;
    }

    const responseMatch = line.match(responsePattern);
    if (!responseMatch) continue;

    expect(currentPrompt, `${questionId} response ${responseMatch[2]} must follow a subgroup prompt`).not.toBeNull();
    const [, value, name, condition, label] = responseMatch;
    let group = groupsByName.get(name);
    if (!group) {
      group = { name, prompt: currentPrompt, responses: [] };
      groupsByName.set(name, group);
      groups.push(group);
    }
    group.responses.push({
      value,
      condition: safelyDecodeCondition(condition),
      label: normalizeText(label),
    });
  }

  return groups;
}

function previousConditionalPrompt(firstResponse) {
  for (let node = firstResponse.previousSibling; node; node = node.previousSibling) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() === '') continue;
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    if (node.tagName === 'BR') continue;
    if (node.matches('.displayif[displayif]')) return node;
    if (node.matches('.response')) return null;
  }
  return null;
}

describe('locked Module 4 conditional compound-radio structure @corpus', () => {
  it.each(['en', 'es'])('preserves all conditional subgroup prompts and native radios in %s', async (locale) => {
    const markdown = readLockedMarkdown('module4', locale);
    const quest = await renderFreshQuest({
      markdown,
      params: {
        lang: locale,
        showProgressBarInQuest: false,
      },
    });

    expect(quest.rendered).toBe(true);
    expect(quest.errors).toEqual([]);
    const questionProcessor = quest.state.getQuestionProcessor();
    quest.moduleParams.isRenderer = true;
    const accessibility = await import('../../accessibleQuestionTextBuilder.js');

    for (const questionId of conditionalCompoundQuestionIds) {
      const questionLines = lockedQuestionBlock(markdown, questionId);
      const authoredGroups = authoredCompoundGroups(questionLines, questionId);
      const { question } = questionProcessor.findQuestion(questionId);

      expect(question, `${locale} Module 4 must render ${questionId}`).not.toBeNull();
      expect(authoredGroups, `${questionId} must contain eight authored prompt mappings`).toHaveLength(8);
      expect(new Set(authoredGroups.map(({ name }) => name)).size).toBe(8);
      expect(authoredGroups.flatMap(({ responses }) => responses)).toHaveLength(40);

      if (indentedResponseQuestionIds.has(questionId)) {
        expect(
          questionLines.filter((line) => /^\s+\(\d+:/.test(line)),
          `${questionId} must retain its 40 indented authored response lines`,
        ).toHaveLength(40);
      }

      const radios = Array.from(question.querySelectorAll('input[type="radio"]'));
      expect(radios, `${questionId} must render all 40 native radios`).toHaveLength(40);
      expect(new Set(radios.map(({ name }) => name))).toEqual(
        new Set(authoredGroups.map(({ name }) => name)),
      );

      const mappedPrompts = new Set();
      for (const authoredGroup of authoredGroups) {
        expect(authoredGroup.responses).toHaveLength(5);
        expect(authoredGroup.responses.map(({ value }) => value)).toEqual(expectedDurationValues);
        expect(new Set(authoredGroup.responses.map(({ condition }) => condition))).toEqual(
          new Set([authoredGroup.prompt.condition]),
        );

        const groupRadios = radios.filter(({ name }) => name === authoredGroup.name);
        expect(groupRadios, `${questionId}.${authoredGroup.name} must render five radios`).toHaveLength(5);
        expect(groupRadios.map(({ value }) => value)).toEqual(expectedDurationValues);

        const firstResponse = groupRadios[0].closest('.response');
        const prompt = previousConditionalPrompt(firstResponse);
        expect(prompt, `${questionId}.${authoredGroup.name} must retain its preceding prompt`).not.toBeNull();
        mappedPrompts.add(prompt);
        expect(normalizeText(prompt.textContent)).toBe(authoredGroup.prompt.text);
        expect(safelyDecodeCondition(prompt.getAttribute('displayif'))).toBe(
          authoredGroup.prompt.condition,
        );

        for (const [index, input] of groupRadios.entries()) {
          const authoredResponse = authoredGroup.responses[index];
          const response = input.closest('.response');
          const labels = Array.from(input.labels);

          expect(input.type).toBe('radio');
          expect(input.name).toBe(authoredGroup.name);
          expect(input.value).toBe(authoredResponse.value);
          expect(input.id).toBe(`${authoredGroup.name}_${authoredResponse.value}`);
          expect(input.hasAttribute('aria-label')).toBe(false);
          expect(input.hasAttribute('aria-labelledby')).toBe(false);
          expect(labels).toHaveLength(1);
          expect(labels[0].htmlFor).toBe(input.id);
          expect(normalizeText(labels[0].textContent)).toBe(authoredResponse.label);
          expect(safelyDecodeCondition(response.getAttribute('displayif'))).toBe(
            authoredGroup.prompt.condition,
          );
        }
      }

      expect(mappedPrompts, `${questionId} must map to eight distinct subgroup prompts`).toHaveLength(8);

      const fieldset = question.querySelector(':scope > fieldset');
      accessibility.manageAccessibleQuestion(fieldset, false);
      const semanticGroups = Array.from(fieldset.querySelectorAll(':scope > [role="radiogroup"]'));
      expect(semanticGroups, `${questionId} must expose all eight conditional groups`).toHaveLength(8);
      for (const group of semanticGroups) {
        const ownedIds = group.getAttribute('aria-owns').split(/\s+/).filter(Boolean);
        const ownedRadios = ownedIds.map((id) => question.querySelector(`#${id}`));
        expect(group.getAttribute('aria-label')).toBe(normalizeText(group.textContent));
        expect(group.hasAttribute('tabindex')).toBe(false);
        expect(ownedIds).toHaveLength(5);
        expect(ownedRadios.every(Boolean)).toBe(true);
        expect(new Set(ownedRadios.map(({ name }) => name))).toHaveLength(1);
        expect(ownedRadios.every((radio) => radio.closest('.response').parentElement === fieldset)).toBe(true);
      }
    }
  });
});
