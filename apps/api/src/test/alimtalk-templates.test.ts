import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NOTIFICATION_EVENTS, NOTIFICATION_EVENT_POLICY } from '@weddingpick/domain';

import { TEMPLATES_FILE, loadTemplates } from '../notify/alimtalk/templates';

const ROOT = join(__dirname, '..', '..', '..', '..');

/**
 * 승인본과 저장소의 문안이 갈리지 않게 지킨다.
 *
 * 카카오에 사전 승인된 문안과 한 글자라도 다르면 발송이 반려된다. 반려는 재심사고
 * 재심사는 며칠이다 — 여기서 몇 초 만에 잡는다.
 */

describe('알림톡 템플릿 정본', () => {
  const templates = loadTemplates();

  it('spec/alimtalk.templates.json을 읽고 변수와 본문이 맞는지 확인한다', () => {
    expect(TEMPLATES_FILE).toBe(join(ROOT, 'spec', 'alimtalk.templates.json'));
    expect(Object.keys(templates)).toHaveLength(6);
  });

  it('여섯 이벤트가 쓰는 템플릿이 모두 정본에 있다', () => {
    for (const event of NOTIFICATION_EVENTS) {
      const { templateId } = NOTIFICATION_EVENT_POLICY[event];
      const ids = typeof templateId === 'string' ? [templateId] : Object.values(templateId);

      for (const id of ids) {
        expect(templates[id]).toBeDefined();
      }
    }
  });

  it('정본에 있는 템플릿은 모두 어느 이벤트든 쓰고 있다', () => {
    const used = new Set<string>();

    for (const event of NOTIFICATION_EVENTS) {
      const { templateId } = NOTIFICATION_EVENT_POLICY[event];
      if (typeof templateId === 'string') used.add(templateId);
      else for (const id of Object.values(templateId)) used.add(id);
    }

    expect([...Object.keys(templates)].sort()).toEqual([...used].sort());
  });

  it('버튼 이름이 비어 있지 않다 — 버튼은 카카오에 따로 등록한다', () => {
    for (const template of Object.values(templates)) {
      expect(template.button.trim().length).toBeGreaterThan(0);
    }
  });

  /*
   * 카카오 템플릿 심사를 아직 하나도 통과하지 않았다.
   *
   * 이 테스트가 깨지는 때는 승인본이 저장소에 반영된 때다. 그때 이 기대값을 함께
   * 고친다 — 준비가 안 된 것을 «완료»로 표시하지 않기 위한 잠금이다.
   */
  it('승인 전이라 어떤 템플릿도 알림톡을 보내지 않는다', () => {
    for (const template of Object.values(templates)) {
      expect(template.approved).toBe(false);
    }
  });

  it('본문에 금지어를 쓰지 않는다', () => {
    const glossary = JSON.parse(readFileSync(join(ROOT, 'spec', 'glossary.json'), 'utf8')) as {
      banned: { term: string }[];
    };

    for (const template of Object.values(templates)) {
      for (const { term } of glossary.banned) {
        expect(`${template.templateId}: ${template.body}`).not.toContain(term);
      }
    }
  });

  it('본문에 광고 문구를 섞지 않는다 — 심사 통과가 목적이다', () => {
    // 「다음 이벤트도 참여하세요」 같은 유도 문구는 알림톡 심사에서 반려된다.
    const adWords = ['할인', '특가', '무료', '이벤트에 참여', '지금 바로', '친구 추가'];

    for (const template of Object.values(templates)) {
      for (const word of adWords) {
        expect(`${template.templateId}: ${template.body}`).not.toContain(word);
      }
    }
  });
});
