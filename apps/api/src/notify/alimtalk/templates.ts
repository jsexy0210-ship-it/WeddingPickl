/**
 * 템플릿 정본을 읽는다.
 *
 * 정본은 `spec/alimtalk.templates.json` 하나다(CLAUDE.md — 문구는 spec에서만).
 * 여기서는 읽어서 모양만 확인하고, 문안을 다시 적지 않는다.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { templateMismatch, type AlimtalkTemplate } from '@weddingpick/domain';

export const TEMPLATES_FILE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'spec',
  'alimtalk.templates.json'
);

type TemplateFile = {
  templates: Record<
    string,
    {
      situation: string;
      variables: string[];
      button: string;
      approved: boolean;
      body: string;
    }
  >;
};

let cached: Record<string, AlimtalkTemplate> | undefined;

/**
 * 템플릿 전부. 처음 한 번만 읽는다.
 *
 * 읽는 김에 선언한 변수와 본문이 어긋났는지 본다 — 어긋난 템플릿으로는 승인된
 * 문안을 만들 수 없으므로, 발송 직전이 아니라 여기서 멈추는 편이 낫다.
 */
export function loadTemplates(file: string = TEMPLATES_FILE): Record<string, AlimtalkTemplate> {
  if (cached && file === TEMPLATES_FILE) return cached;

  const parsed = JSON.parse(readFileSync(file, 'utf8')) as TemplateFile;
  const templates: Record<string, AlimtalkTemplate> = {};

  for (const [templateId, entry] of Object.entries(parsed.templates)) {
    const template: AlimtalkTemplate = { templateId, ...entry };
    const { missingInBody, undeclared } = templateMismatch(template);

    if (missingInBody.length > 0 || undeclared.length > 0) {
      throw new Error(
        `${templateId} 템플릿의 변수와 본문이 어긋난다: ` +
          `본문에 없음 ${missingInBody.join(', ') || '없음'} · ` +
          `선언에 없음 ${undeclared.join(', ') || '없음'}`
      );
    }

    templates[templateId] = template;
  }

  if (file === TEMPLATES_FILE) cached = templates;

  return templates;
}

export function findTemplate(templateId: string): AlimtalkTemplate {
  const template = loadTemplates()[templateId];

  if (!template) {
    throw new Error(`${templateId} 템플릿이 spec/alimtalk.templates.json에 없다.`);
  }

  return template;
}
